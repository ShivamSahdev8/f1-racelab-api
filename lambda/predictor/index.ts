import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || 'us-east-2',
});

interface PredictionRequest {
  driver: string;
  circuit: string;
  tyres: string;
  weather: string;
  downforce: string;
  strategy: string;
}

export const handler = async (event: any) => {
  try {
    const body: PredictionRequest = JSON.parse(event.body);

    // Fetch race data from Ergast API
    const raceData = await fetchRaceData(body.circuit);
    const driverData = await fetchDriverData(body.driver);

    // Build AI prompt
    const prompt = buildPrompt(body, raceData, driverData);

    // Call Bedrock
    const prediction = await callBedrock(prompt);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(prediction),
    };
  } catch (error: any) {
    console.error('Prediction error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};

async function fetchRaceData(circuit: string): Promise<any> {
  const res = await fetch(
    `https://api.jolpi.ca/ergast/f1/current.json`
  );
  const data = await res.json();
  return data.MRData.RaceTable.Races;
}

async function fetchDriverData(driver: string): Promise<any> {
  const res = await fetch(
    `https://api.jolpi.ca/ergast/f1/current/driverStandings.json`
  );
  const data = await res.json();
  return data.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || [];
}

function buildPrompt(
  request: PredictionRequest,
  races: any[],
  standings: any[]
): string {
  const standingsText = standings
    .slice(0, 10)
    .map(
      (s: any) =>
        `P${s.position}: ${s.Driver.givenName} ${s.Driver.familyName} (${s.Constructors[0].name}) - ${s.points} pts, ${s.wins} wins`
    )
    .join('\n');

  return `You are an F1 race prediction AI. Based on the data below, predict the race outcome.

CURRENT SEASON STANDINGS:
${standingsText}

RACE SETUP:
Driver: ${request.driver}
Circuit: ${request.circuit}
Tyre Compound: ${request.tyres}
Weather: ${request.weather}
Downforce Level: ${request.downforce}
Strategy: ${request.strategy}

Respond ONLY in this JSON format, no other text:
{
  "winChance": <number 0-100>,
  "podiumChance": <number 0-100>,
  "expectedPosition": <number 1-20>,
  "expectedPoints": <number>,
  "insight": "<2-3 sentence explanation of prediction>",
  "riskFactor": "<LOW|MEDIUM|HIGH>",
  "optimalSetup": {
    "tyres": "<SOFT|MEDIUM|HARD|INTERMEDIATE|WET>",
    "strategy": "<1-STOP|2-STOP|3-STOP>",
    "downforce": "<LOW|MEDIUM|HIGH>",
    "winChance": <number 0-100>,
    "explanation": "<1 sentence why this is better>"
  },
  "funFact": "<interesting F1 fact about this driver or circuit>"
}`;
}

async function callBedrock(prompt: string): Promise<any> {
  const modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.content[0].text;

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error('Failed to parse AI response');
}