import type { AssistantResponse } from "../src/assistant-response";

export interface CsvRow {
  [column: string]: string;
}

/** The complete assistant-authored text visible in chat, including option bodies. */
export function visibleResponseText(response: AssistantResponse | undefined): string | undefined {
  if (!response) return undefined;
  if (response.kind === "reflection") {
    return [response.text, ...response.reflection.claims.map((claim) => `- ${claim.text}`)].join("\n");
  }
  if (response.kind === "options") {
    return [response.text, ...response.options.map((option) => `- ${option.text}`)].join("\n");
  }
  if (response.kind === "map_proposal") {
    return `${response.text}\nProposed map action: ${JSON.stringify(response.action)}`;
  }
  return response.text;
}

export interface LevelJudgmentSummary {
  level: 0 | 2;
  count: number;
  introducedConcepts: number;
  unstatedRelationships: number;
  unraisedDirections: number;
  directiveness: number;
  attributedAiMaterial: number;
  aiMaterialCases: number;
  questionPremises: number;
  questionCases: number;
  confusingQuoteQuestions: number;
  quoteQuestionCases: number;
}

function csvCell(value: string | number | boolean | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function encodeCsv(headers: string[], rows: Array<Record<string, string | number | boolean | undefined>>): string {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n") + "\r\n";
}

export function parseCsv(input: string): CsvRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { record.push(field); field = ""; }
    else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  if (field.length || record.length) { record.push(field.replace(/\r$/, "")); records.push(record); }
  const headers = records.shift() ?? [];
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function judgment(row: CsvRow, column: string, allowed: string[]): string {
  const value = (row[column] ?? "").trim().toUpperCase();
  if (!allowed.includes(value)) throw new Error(`${row.record_id || "unknown record"}: ${column} must be ${allowed.join("/")}.`);
  return value;
}

export function validateHandscoreRows(rows: CsvRow[], expectedCount = 40): void {
  if (rows.length !== expectedCount) throw new Error(`Expected ${expectedCount} scored rows, found ${rows.length}.`);
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.record_id || ids.has(row.record_id)) throw new Error(`Missing or duplicate record_id: ${row.record_id || "(blank)"}.`);
    ids.add(row.record_id);
    judgment(row, "introduced_absent_concept", ["Y", "N"]);
    judgment(row, "asserted_unstated_relationship", ["Y", "N"]);
    judgment(row, "offered_unraised_direction", ["Y", "N"]);
    judgment(row, "ai_material_attributed", ["Y", "N", "NA"]);
    judgment(row, "question_embeds_unstated_premise", ["Y", "N", "NA"]);
    // Older local run sheets predate this rubric column; retain reportability
    // without inventing a judgment. New sheets always include and require it.
    if ("question_uses_confusing_quotation" in row) judgment(row, "question_uses_confusing_quotation", ["Y", "N", "NA"]);
  }
}

export function aggregateHandscores(rows: CsvRow[]): LevelJudgmentSummary[] {
  return ([0, 2] as const).map((level) => {
    const selected = rows.filter((row) => Number(row.level) === level);
    const yes = (row: CsvRow, column: string) => row[column]?.trim().toUpperCase() === "Y";
    const aiCases = selected.filter((row) => row.ai_material_attributed?.trim().toUpperCase() !== "NA");
    const questionCases = selected.filter((row) => row.question_embeds_unstated_premise?.trim().toUpperCase() !== "NA");
    const quoteQuestionCases = selected.filter((row) => {
      const value = row.question_uses_confusing_quotation?.trim().toUpperCase();
      return Boolean(value && value !== "NA");
    });
    return {
      level,
      count: selected.length,
      introducedConcepts: selected.filter((row) => yes(row, "introduced_absent_concept")).length,
      unstatedRelationships: selected.filter((row) => yes(row, "asserted_unstated_relationship")).length,
      unraisedDirections: selected.filter((row) => yes(row, "offered_unraised_direction")).length,
      directiveness: selected.filter((row) => yes(row, "introduced_absent_concept") || yes(row, "asserted_unstated_relationship") || yes(row, "offered_unraised_direction")).length,
      attributedAiMaterial: aiCases.filter((row) => yes(row, "ai_material_attributed")).length,
      aiMaterialCases: aiCases.length,
      questionPremises: questionCases.filter((row) => yes(row, "question_embeds_unstated_premise")).length,
      questionCases: questionCases.length,
      confusingQuoteQuestions: quoteQuestionCases.filter((row) => yes(row, "question_uses_confusing_quotation")).length,
      quoteQuestionCases: quoteQuestionCases.length,
    };
  });
}

export function ratioText(value: number, denominator: number): string {
  return denominator ? `${value}/${denominator} (${((value / denominator) * 100).toFixed(1)}%)` : "n/a";
}
