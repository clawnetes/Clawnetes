import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

export interface E2EConfig {
  userName: string;
  agentName: string;
  aiProvider: string;
  authMethod: string;
  apiKey: string;
  model: string;
  messagingChannel: "telegram" | "whatsapp";
  telegramBotToken?: string;
  whatsappDmPolicy?: string;
  whatsappPhone?: string;
}

export function loadE2EConfig(): E2EConfig {
  const envPath = resolve(process.cwd(), ".env.e2e");
  const result = dotenvConfig({ path: envPath });

  if (result.error) {
    throw new Error(
      `Failed to load .env.e2e: ${result.error.message}\n` +
        "Copy .env.e2e.example to .env.e2e and fill in your credentials."
    );
  }

  const env = result.parsed ?? process.env;

  function require(key: string): string {
    const val = env[key] || process.env[key];
    if (!val) {
      throw new Error(`Missing required env var: ${key} in .env.e2e`);
    }
    return val;
  }

  const messagingChannel = require("MESSAGING_CHANNEL") as "telegram" | "whatsapp";

  if (messagingChannel === "telegram") {
    require("TELEGRAM_BOT_TOKEN");
  } else if (messagingChannel === "whatsapp") {
    require("WHATSAPP_PHONE");
  }

  return {
    userName: require("USER_NAME"),
    agentName: require("AGENT_NAME"),
    aiProvider: require("AI_PROVIDER"),
    authMethod: env["AUTH_METHOD"] || process.env["AUTH_METHOD"] || "token",
    apiKey: require("API_KEY"),
    model: require("MODEL"),
    messagingChannel,
    telegramBotToken: env["TELEGRAM_BOT_TOKEN"] || process.env["TELEGRAM_BOT_TOKEN"],
    whatsappDmPolicy: env["WHATSAPP_DM_POLICY"] || process.env["WHATSAPP_DM_POLICY"],
    whatsappPhone: env["WHATSAPP_PHONE"] || process.env["WHATSAPP_PHONE"],
  };
}
