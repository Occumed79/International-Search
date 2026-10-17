import test from "node:test";
import assert from "node:assert/strict";
import { qualifySearchHitsWithGroq } from "../src/services/groqQualification.ts";

const clinic = (url = "https://sample.example/clinic") => ({
  url, title: "Lincoln Medical Clinic",
  snippet: "Lincoln Medical Clinic 17 Main Street Fresno California physical exams and vaccines",
  source: "keenable",
});
const directory = () => ({
  url: "https://examples.example/best-clinics",
  title: "Top 10 Medical Clinics in Fresno",
  snippet: "Browse our directory of best clinics in Fresno.",
  source: "tinyfish",
});
const reply = (evaluations) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ evaluations }) } }] }),
});

test("missing Groq key is a no-op and does not call the API", async () => {
  const hits = [clinic()];
  let called = false;
  const result = await qualifySearchHitsWithGroq(hits, "medical clinics", {
    apiKey: "", fetchImpl: async () => { called = true; return reply([]); },
  });
  assert.deepEqual(result, hits);
  assert.equal(called, false);
});

test("one bounded Groq review removes only source-grounded directories", async () => {
  const hits = [directory(), clinic()];
  const result = await qualifySearchHitsWithGroq(hits, "clinic Fresno", {
    apiKey: "dummy", fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      const body = JSON.parse(init.body);
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.model, "openai/gpt-oss-20b");
      return reply([
        { index: 0, kind: "non_provider", official_name: "", evidence_quote: "Top 10 Medical Clinics in Fresno" },
        { index: 1, kind: "provider", official_name: "Lincoln Medical Clinic", evidence_quote: "Lincoln Medical Clinic 17 Main Street" },
      ]);
    },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].url, hits[1].url);
  assert.ok(result[0].content.includes("Lincoln Medical Clinic 17 Main Street"));
});

test("unsubstantiated Groq rejection cannot remove a real clinic", async () => {
  const hits = [clinic()];
  const result = await qualifySearchHitsWithGroq(hits, "clinics", {
    apiKey: "dummy", fetchImpl: async () => reply([
      { index: 0, kind: "non_provider", official_name: "", evidence_quote: "fabricated proof" },
    ]),
  });
  assert.deepEqual(result, hits);
});

test("Groq outages and invalid replies fail open", async () => {
  const hits = [clinic()];
  assert.deepEqual(await qualifySearchHitsWithGroq(hits, "clinics", {
    apiKey: "dummy", fetchImpl: async () => { throw new Error("network outage"); },
  }), hits);
  assert.deepEqual(await qualifySearchHitsWithGroq(hits, "clinics", {
    apiKey: "dummy", fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [] }) }),
  }), hits);
});

test("model cannot invent a clinic name or evidence", async () => {
  const hits = [clinic()];
  const result = await qualifySearchHitsWithGroq(hits, "clinics", {
    apiKey: "dummy", fetchImpl: async () => reply([
      { index: 0, kind: "provider", official_name: "Invented Hospital", evidence_quote: "Imaginary Clinic" },
    ]),
  });
  assert.deepEqual(result, hits);
});

test("valid official clinic name must be present in source", async () => {
  const hits = [{
    url: "https://sample.example/clinic", title: "Contact | Example Healthcare",
    snippet: "Example Healthcare Clinic at 12 Oak Street Fresno", source: "keenable",
  }];
  const result = await qualifySearchHitsWithGroq(hits, "clinics", {
    apiKey: "dummy", fetchImpl: async () => reply([
      { index: 0, kind: "provider", official_name: "Example Healthcare Clinic", evidence_quote: "Example Healthcare Clinic at 12 Oak Street" },
    ]),
  });
  assert.equal(result[0].title, "Example Healthcare Clinic");
  assert.equal(result[0].url, hits[0].url);
});

test("AI review is capped at eight candidates per search", async () => {
  const hits = Array.from({ length: 12 }, (_, i) => clinic("https://sample.example/" + i));
  let count = 0;
  const result = await qualifySearchHitsWithGroq(hits, "clinics", {
    apiKey: "dummy", fetchImpl: async (_, init) => {
      count = JSON.parse(JSON.parse(init.body).messages[1].content).candidates.length;
      return reply([]);
    },
  });
  assert.equal(count, 8);
  assert.equal(result.length, 12);
  assert.deepEqual(result.slice(8), hits.slice(8));
});
