import { createOpenAI } from "@ai-sdk/openai";
import { SERVER_URL } from "./index";

export const openai = createOpenAI({
	baseURL: `${SERVER_URL}/openai`,
	apiKey: "unused",
});

export const OPENAI_MODEL = "gpt-4o";
