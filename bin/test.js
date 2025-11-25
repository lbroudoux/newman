const commander = require('commander');
const { Option } = require('commander');

const program = new commander.Command();

// Add nested commands using `.command()`.
const test = program.command('test')
  .description('Launch conformance tests from your sandbox')
  .requiredOption('-s, --service <service name:service version>', 'Name and version of the service to test', 'petstore:1.0.0')
  .requiredOption('-e, --endpoint <test endpoint>', 'URL of the endpoint to test against', 'http://localhost:8080')
  .addOption(
    new Option('-r, --runner <runner>', 'Specify the test runner to use (e.g., "OPEN_API_SCHEMA", "POSTMAN")', 'OPEN_API_SCHEMA')
      .choices(['HTTP', 'OPEN_API_SCHEMA', 'ASYNC_API_SCHEMA', 'POSTMAN', 'GRPC_PROTOBUF', 'GRAPHQL_SCHEMA'])
  )
  .option('-t, --timeout <timeout>', 'Specify the timeout for the tests in milliseconds', '10000')
  .action(async (options) => {
    // Build test request from options.
    var testRequest = {
      serviceId: options.service,
      testEndpoint : options.endpoint,
      runnerType : options.runner,
      timeout: parseInt(options.timeout)
    }
    // Launch test request on sandbox.
    const response = await fetch("http://localhost:8585/api/tests", {
      method: 'POST',
      body: JSON.stringify(testRequest),
      headers: {
        'Content-Type': 'application/json'
      },
    });

    if (response.status == 201) {
      const responseJson = await response.json()
      const testResultId = responseJson.id;

      const endDate = Date.now() + testRequest.timeout + 1000;
      var testResult = await refreshTestResult(testResultId);
      while (testResult.inProgress && Date.now() < endDate) {
        await new Promise(resolve => setTimeout(resolve, 250));
        testResult = await refreshTestResult(testResultId);
      }

      console.log('ℹ️  Test execution completed. Results available at: http://localhost:8585/#/tests/' + testResultId);

      if (!testResult.inProgress) {
        if (testResult.success) {
          console.log('✅ All tests passed successfully!');  
        } else {
          console.log('❌ Some tests failed.');
        }
      }
      testResult.testCaseResults.forEach(suite => {
        console.log(`\nTest Suite: '${suite.operationName}'`);
        suite.testStepResults.forEach(testCase => {
          const statusIcon = testCase.success ? '✅' : '❌';
          console.log(`  ${statusIcon} Test Case: '${testCase.requestName}'`);
        }); 
      });
    } else {
      console.error('🚨 Error while launching tests on sandbox, code: ' + response.status);
    }
  });   

function refreshTestResult(testResultId) {
  return fetch("http://localhost:8585/api/tests/" + testResultId)
      .then(response => {
        if (!response.ok) {
          throw new Error('Error while fetching TestResult on Microcks, code: ' + response.status);
        }
        return response.json();
      })
}

module.exports = {
  command: test
};