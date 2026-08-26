const assert = require('node:assert/strict');
const { parseWeatherQuestion, referenceWeatherProbability } = require('../dist/features/weather-forecast');

{
  const parsed = parseWeatherQuestion('Will temperatures in Berlin, Germany, reach 40°C this summer?');
  assert.equal(parsed?.location, 'Berlin');
  assert.equal(parsed?.metric, 'temperature_max');
  assert.equal(parsed?.comparison, 'gte');
  assert.equal(parsed?.displayValue, 40);
  assert.equal(parsed?.unit, '°C');
}

{
  const parsed = parseWeatherQuestion('Will London high temperature exceed 15°C on 2026-04-14?');
  assert.equal(parsed?.location, 'London');
  assert.equal(parsed?.metric, 'temperature_max');
  assert.equal(parsed?.date, '2026-04-14');
}

{
  const parsed = parseWeatherQuestion('Will rainfall in Singapore be at least 20 mm tomorrow?');
  assert.equal(parsed?.location, 'Singapore');
  assert.equal(parsed?.metric, 'precipitation');
  assert.equal(parsed?.comparison, 'gte');
  assert.equal(parsed?.displayValue, 20);
  assert.equal(parsed?.unit, 'mm');
}

{
  // A value far above the forecast should imply a small YES reference; a near
  // forecast should not collapse to zero because forecasts are uncertain.
  const cold = referenceWeatherProbability({ metric: 'temperature_max', comparison: 'gte', valueC: 42 }, {
    dates: ['2026-08-25'],
    temperatureMaxC: [26],
  }, 0);
  const warm = referenceWeatherProbability({ metric: 'temperature_max', comparison: 'gte', valueC: 27 }, {
    dates: ['2026-08-25'],
    temperatureMaxC: [26],
  }, 0);
  assert.ok(cold < 0.08);
  assert.ok(warm > 0.25 && warm < 0.75);
}

console.log('weather forecast helpers: all assertions passed');
