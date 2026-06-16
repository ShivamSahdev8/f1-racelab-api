// test/predictor.test.ts
import { response, buildOverviewPrompt, findNextRace, buildPredictionPrompt } from './index'; // requires you to export `response`

describe('response()', () => {                    // groups related tests
  test('wraps the body as a JSON string', () => { // one specific behavior
    // Arrange
    const body = { hello: 'world' };

    // Act
    const result = response(200, body);

    // Assert
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"hello":"world"}'); // note: body gets JSON.stringify'd
    expect(result.headers['Content-Type']).toBe('application/json');
  });
});