import "dotenv/config";

// Tests always run against the deterministic provider so assertions can be
// exact; the OpenAI path is covered by its own unit test with a stubbed fetch.
process.env.AI_PROVIDER = "mock";
process.env.DEMO_MODE = "true";
process.env.AUTH_SECRET ??= "test-secret-value-that-is-long-enough";
