const os = require('os');
const fs = require('fs');
const { readFile } = require('fs/promises');
const path = require("path");
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const zlib = require("node:zlib");
const { pipeline } = require("node:stream");
const { exec } = require('child_process');
var Spinner = require('cli-spinner').Spinner;

const commander = require('commander');

const BUNDER_SERVER = 'http://localhost:5173';

const program = new commander.Command();

// Add nested commands using `.command()`.
const sandbox = program.command('sandbox')
  .description('Manage sandbox for local development and testing');

// Start and run a new sandbox.
sandbox.command('run <bundle>')
  .option('-p, --perf', 'See performance logs of sandbox preparation steps')
  .description('Start and run the sandbox environment')
  .action(async (bundle, options) => {

    if (bundle.endsWith('.zip')) {
      // This is a local file.
      if (!fs.existsSync(bundle)) {
        console.error(`🚨 Bundle file "${bundle}" does not exist.`);
        process.exit(1);
      }  
    } else {
      // This is a bundle from the Postman Network.
      await downloadBundleFile(bundle, options.perf || false);
      bundle = `${os.homedir()}/.microcks-sandbox/downloads/${bundle}.zip`;
    }

    // Uncompress bundle in our own repository.
    await extractBundleFile(bundle, options.perf || false);

    // Start sandbox environment.
    await startSandboxEnvironment(bundle, options.perf || false);

    // Load bundle in sandbox.
    await loadingBundleInSandbox(bundle, options.perf || false);
    
    console.log('✅ Sandbox is up and running on http://localhost:8585');
    console.log('   gRPC mocks are runnning on localhost:8686');
    console.log('   Kafka broker is running on localhost:9092');
  });  

// Status of the local sandbox.
sandbox.command('status')
  .description('Get the status of the sandbox environment')
  .action(async () => {
    try {
      const res = await fetch('http://localhost:8585/api/keycloak/config');
      if (res.ok) {
        console.log('✅ Sandbox is running on http://localhost:8585');
        console.log('   gRPC mocks are runnning on localhost:8686');
        console.log('   Kafka broker is running on localhost:9092');
      } else {
        console.log('❌ Sandbox is not running.');
      }
    } catch (err) {
      console.log('❌ Sandbox is not running.');
    }
  });

// Stop an existing sandbox. 
sandbox.command('stop')
  .description('Stop the sandbox environment')
  .action(async (bundle) => {
    await stopSandboxEnvironment();
    console.log('🛑 Sandbox has been stopped.');
  });

/* */
async function downloadBundleFile(bundle, perf) {
  let start = Date.now();
  console.log(`⬇️  Downloading bundle ${bundle} from the Postman Network...`);
  const downloadsPath = `${os.homedir()}/.microcks-sandbox/downloads`;

  // Prepare downloads directory.
  if (!fs.existsSync(downloadsPath)) {
    try {
      fs.mkdirSync(downloadsPath, { recursive: true });
    } catch (err) {
      Logger.error('🚨 Failed to create downloads directory: ' + err);
      process.exit(1);
    }
  }

  try {
    fs.unlinkSync(downloadsPath + '/' + bundle + '.zip');
  } catch (err) {
    // Ignore if file does not exist.
  }

  // Download the bundle file.
  const res = await fetch(`${BUNDER_SERVER}/api/bundles/${bundle}`);
  const destination = path.resolve(downloadsPath, bundle + '.zip');
  const fileStream = fs.createWriteStream(destination, { flags: 'wx' });
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
  
  let end = Date.now();
  if (perf) {
    console.log(`   ⏱️  ${end - start}ms.\n`);
  }
}

/** */
async function extractBundleFile(bundlePath, perf) {
  let start = Date.now();
  console.log('📂 Extracting bundle to ' + bundlePath + '...');
  const bundleDir = `${os.homedir()}/.microcks-sandbox/bundle`;
  fs.mkdirSync(bundleDir, { recursive: true });

  // Prepare bundle directory.
  if (!fs.existsSync(bundleDir  )) {
    try {
      fs.mkdirSync(bundleDir, { recursive: true });
    } catch (err) {
      console.error('🚨 Failed to create bundle directory: ' + err);
      process.exit(1);
    }
  }

  const unzip = zlib.createUnzip();
  const input = fs.createReadStream(bundlePath);
  const output = fs.createWriteStream(bundleDir);

  pipeline(input, unzip, output, (error) => {});

  let end = Date.now();
  if (perf) {
    console.log(`   ⏱️  ${end - start}ms.\n`);
  }
}

/** */
async function startSandboxEnvironment(bundlePath, perf) {
  let start = Date.now();
  console.log('🚀 Starting sandbox with local ' + bundlePath + '...');

  exec('docker compose -f ./sandbox/microcks-uber.yml up -d', (err, stdout, stderr) => {
    if (err) {
      console.error(`🚨 Error executing command: ${err}`);
      process.exit(1);
    }
    console.log(`${stdout}`);
  });

  const spinner = new Spinner({text: ' Checking sandbox is alive...'})
      .setSpinnerString(19)
      .start();
  await new Promise(resolve => setTimeout(resolve, 200));

  var alive = false;
  var attempt = 0;
  while (!alive) {
    try {
      const res = await fetch('http://localhost:8585/api/keycloak/config');
      if (res.ok) {
        alive = true;
      } else {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    attempt++;
    if (attempt >= 10) {
      console.error('🚨 Sandbox did not start in expected time. Exiting.');
      process.exit(1);
    }
  }

  spinner.stop();

  let end = Date.now();
  if (perf) {
    console.log(`\n   ⏱️  ${end - start}ms.\n`);
  }
}

/** */
async function stopSandboxEnvironment() {
  console.log('✋ Stopping running sandbox...');
  
  exec('docker compose -f ./sandbox/microcks-uber.yml down', (err, stdout, stderr) => {
    if (err) {
      console.error(`🚨 Error executing command: ${err}`);
      process.exit(1);
    }
  });
}

/** */
async function loadingBundleInSandbox(bundlePath, perf) {
  let start = Date.now();
  console.log('📦 Loading bundle in sandbox...')

  // Browse files in primary artifacts dir.
  var artifactsDir = `${os.homedir()}/.microcks-sandbox/bundle/primary`;  
  var artifacts = [];
  fs.readdirSync(artifactsDir).forEach(file => {
    artifacts.push(file);
  });
  for (const file of artifacts) {
    const fullPath = path.join(artifactsDir, file);
    await loadArtifact(fullPath, true);
  }

  artifactsDir = `${os.homedir()}/.microcks-sandbox/bundle/secondary`;
  if (fs.existsSync(artifactsDir)) {
    // Browse files in secondary artifacts dir.
    var artifacts = [];
    fs.readdirSync(artifactsDir).forEach(file => {
      artifacts.push(file);
    });
    for (const file of artifacts) {
      const fullPath = path.join(artifactsDir, file);
      await loadArtifact(fullPath, false);
    }
  }

  let end = Date.now();
  if (perf) {
    console.log(`   ⏱️  ${end - start}ms.\n`);
  }
}

async function loadArtifact(artifactPath, primary) {
  // Initialize delimiters items and multiparBody.
  var crlf = "\r\n",
      boundaryKey = Math.random().toString(16),
      boundary = `--${boundaryKey}`,
      delimeter = `${crlf}--${boundary}`,
      closeDelimeter = `${delimeter}--`,
      multipartBody;

  const filename = path.basename(artifactPath);
  const disposition = `Content-Disposition: form-data; name="file"; filename="${filename}"` + crlf;

  const content = await readFile(artifactPath);
  multipartBody = Buffer.concat([
      Buffer.from(delimeter + crlf + disposition),
      Buffer.from('Content-Type: application/octet-stream' + crlf),
      Buffer.from("Content-Transfer-Encoding: binary" + crlf + crlf),
      content,
      Buffer.from(closeDelimeter)]
  );

  // Prepare headers with content type and length.
  const headers = {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': multipartBody.length.toString(),
  }

  const response = await fetch(`http://localhost:8585/api/artifact/upload?mainArtifact=${primary}`, {
    method: 'POST',
    headers: headers,
    body: multipartBody
  });
  if (response.status != 201) {
    console.error('🚨 Loading bundle artifact failed: ' + response.statusText);
    process.exit(1);
  }
}

module.exports = {
  command: sandbox
};