/**
 * Sample Weather Plugin Handler
 *
 * This is a template showing how to write a plugin handler for Aether OS.
 *
 * Handler signature:
 *   export default async function(params, context) => string
 *
 * - params: the arguments passed by the agent (matches manifest parameters)
 * - context: { pid, cwd, kernel } for accessing kernel subsystems
 *
 * Returns a string result that the agent receives as a tool observation.
 */

// Fake weather database for demonstration
const WEATHER_DATA = {
  'san francisco': { temp: 18, conditions: 'Foggy', humidity: 78, wind: 15 },
  'new york': { temp: 24, conditions: 'Partly Cloudy', humidity: 55, wind: 12 },
  'london': { temp: 15, conditions: 'Rainy', humidity: 85, wind: 20 },
  'tokyo': { temp: 28, conditions: 'Sunny', humidity: 60, wind: 8 },
  'sydney': { temp: 22, conditions: 'Clear', humidity: 45, wind: 10 },
  'berlin': { temp: 12, conditions: 'Overcast', humidity: 70, wind: 18 },
  'paris': { temp: 20, conditions: 'Sunny', humidity: 50, wind: 9 },
  'mumbai': { temp: 33, conditions: 'Humid', humidity: 90, wind: 5 },
};

export default async function getWeather(params, context) {
  const city = (params.city || '').toLowerCase().trim();
  const units = params.units || 'celsius';

  if (!city) {
    return 'Error: city parameter is required.';
  }

  const data = WEATHER_DATA[city];

  if (!data) {
    // Generate random weather for unknown cities
    const temp = Math.floor(Math.random() * 35) + 5;
    const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Windy', 'Clear'][
      Math.floor(Math.random() * 5)
    ];
    const humidity = Math.floor(Math.random() * 60) + 30;
    const wind = Math.floor(Math.random() * 25) + 3;

    const displayTemp =
      units === 'fahrenheit' ? Math.round((temp * 9) / 5 + 32) : temp;
    const unit = units === 'fahrenheit' ? 'F' : 'C';

    return [
      `Weather for ${params.city}:`,
      `  Temperature: ${displayTemp}°${unit}`,
      `  Conditions: ${conditions}`,
      `  Humidity: ${humidity}%`,
      `  Wind: ${wind} km/h`,
      `  (Note: data is simulated)`,
    ].join('\n');
  }

  const displayTemp =
    units === 'fahrenheit'
      ? Math.round((data.temp * 9) / 5 + 32)
      : data.temp;
  const unit = units === 'fahrenheit' ? 'F' : 'C';

  return [
    `Weather for ${params.city}:`,
    `  Temperature: ${displayTemp}°${unit}`,
    `  Conditions: ${data.conditions}`,
    `  Humidity: ${data.humidity}%`,
    `  Wind: ${data.wind} km/h`,
  ].join('\n');
}
