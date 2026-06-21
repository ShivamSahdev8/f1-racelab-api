// test/predictor.test.ts
import {
  response,
  buildOverviewPrompt,
  findNextRace,
  buildPredictionPrompt,
} from "./index"; // requires you to export `response`

describe("response()", () => {
  // groups related tests
  test("wraps the body as a JSON string", () => {
    // one specific behavior
    // Arrange
    const body = { hello: "world" };

    // Act
    const result = response(200, body);

    // Assert
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('{"hello":"world"}'); // note: body gets JSON.stringify'd
    expect(result.headers["Content-Type"]).toBe("application/json");
  });
});

describe("findNextRace()", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-20T12:00:00Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  test("When a future race exists → return it", () => {
    const races = [
      { raceName: "Alpha GP", date: "2026-06-10" },
      { raceName: "Beta GP", date: "2026-06-25" },
      { raceName: "Gamma GP", date: "2026-07-01" },
    ];
    expect(findNextRace(races)).toEqual({
      raceName: "Beta GP",
      date: "2026-06-25",
    });
  });

  test("When No future race exists → return the last race", () => {
    const races = [
      { raceName: "Alpha GP", date: "2026-06-10" },
      { raceName: "Beta GP", date: "2026-06-15" },
    ];
    expect(findNextRace(races)).toEqual({
      raceName: "Beta GP",
      date: "2026-06-15",
    });
  });

  test("returns undefined when race list is empty", () => {
    expect(findNextRace([])).toBeUndefined();
  });
});
