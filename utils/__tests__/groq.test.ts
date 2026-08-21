import { describe, expect, it } from 'vitest';
import {
  normalizeClarifyResult,
  normalizeOptimizeResult,
  parseClarifyContent,
  parseOptimizeContent,
} from '../groq';

describe('normalizeOptimizeResult', () => {
  it('accepts the canonical PRD example shape', () => {
    const raw = {
      structured_template:
        'Write a cold outreach email to a tech startup targeting the [department] department. The tone should be [tone].',
      variables: {
        department: ['Engineering', 'Product Management', 'Growth Marketing'],
        tone: ['Bold & Direct', 'Empathetic', 'Witty'],
      },
    };
    const result = normalizeOptimizeResult(raw)!;
    expect(result).not.toBeNull();
    expect(result.structuredTemplate).toContain('[department]');
    expect(result.variables['department']).toHaveLength(3);
    expect(result.variables['tone']).toEqual(['Bold & Direct', 'Empathetic', 'Witty']);
  });

  it('adds empty option lists for tokens the model forgot to define', () => {
    const result = normalizeOptimizeResult({
      structured_template: 'Write a [format] about [topic].',
      variables: { format: ['essay', 'poem', 'thread'] },
    })!;
    expect(result.variables['topic']).toEqual([]);
    expect(result.variables['format']).toHaveLength(3);
  });

  it('drops variables that never appear in the template', () => {
    const result = normalizeOptimizeResult({
      structured_template: 'Write a [format].',
      variables: { format: ['essay', 'poem', 'thread'], orphan: ['a', 'b', 'c'] },
    })!;
    expect(Object.keys(result.variables)).toEqual(['format']);
  });

  it('caps options at 3 and strips empties/non-strings', () => {
    const result = normalizeOptimizeResult({
      structured_template: 'Pick a [thing].',
      variables: { thing: ['one', '', 2, null, 'three', 'four', 'five'] },
    })!;
    expect(result.variables['thing']).toEqual(['one', '2', 'three']);
  });

  it('tolerates alternative template keys', () => {
    expect(normalizeOptimizeResult({ structuredTemplate: 'Do [x].', variables: { x: ['a'] } })).not.toBeNull();
    expect(normalizeOptimizeResult({ template: 'Do [x].', variables: { x: ['a'] } })).not.toBeNull();
  });

  it('rejects junk', () => {
    expect(normalizeOptimizeResult(null)).toBeNull();
    expect(normalizeOptimizeResult('nope')).toBeNull();
    expect(normalizeOptimizeResult({ variables: {} })).toBeNull();
    expect(normalizeOptimizeResult({ structured_template: '   ' })).toBeNull();
  });

  it('handles templates with no tokens at all', () => {
    const result = normalizeOptimizeResult({
      structured_template: 'A fully specified prompt already.',
      variables: {},
    })!;
    expect(result.variables).toEqual({});
  });

  it('matches snake_case variable keys for tokens written with spaces', () => {
    const result = normalizeOptimizeResult({
      structured_template: 'Set the [output format].',
      variables: { output_format: ['json', 'yaml', 'tsv'] },
    })!;
    expect(result.variables['output format']).toEqual(['json', 'yaml', 'tsv']);
  });
});

describe('parseOptimizeContent', () => {
  it('parses plain JSON', () => {
    const content = JSON.stringify({
      structured_template: 'Say [thing].',
      variables: { thing: ['hi', 'hey', 'hello'] },
    });
    expect(parseOptimizeContent(content).structuredTemplate).toBe('Say [thing].');
  });

  it('strips markdown fences some models add', () => {
    const content =
      '```json\n{"structured_template":"Say [thing].","variables":{"thing":["hi","hey","hello"]}}\n```';
    expect(parseOptimizeContent(content).variables['thing']).toHaveLength(3);
  });

  it('throws GroqError(PARSE) on invalid JSON', () => {
    expect(() => parseOptimizeContent('not json at all')).toThrowError(/JSON/);
  });

  it('throws GroqError(PARSE) on schema mismatch', () => {
    expect(() => parseOptimizeContent('{"foo": 1}')).toThrowError(/schema/);
  });
});

describe('normalizeClarifyResult', () => {
  it('accepts a well-formed question list', () => {
    const result = normalizeClarifyResult({
      questions: [
        { id: 'audience', question: 'Who is it for?', suggestions: ['Devs', 'Execs', 'General'] },
        { id: 'tone', question: 'What tone?', suggestions: ['Formal', 'Casual'] },
      ],
    })!;
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].suggestions).toHaveLength(3);
    expect(result.questions[1].suggestions).toEqual(['Formal', 'Casual']);
  });

  it('caps at 5 questions and 3 suggestions each', () => {
    const result = normalizeClarifyResult({
      questions: Array.from({ length: 8 }, (_, i) => ({
        id: `q${i}`,
        question: `Question ${i}?`,
        suggestions: ['a', 'b', 'c', 'd'],
      })),
    })!;
    expect(result.questions).toHaveLength(5);
    expect(result.questions[0].suggestions).toEqual(['a', 'b', 'c']);
  });

  it('drops entries with no question and backfills missing ids', () => {
    const result = normalizeClarifyResult({
      questions: [
        { id: '', question: 'Real one?', suggestions: [] },
        { question: '   ', suggestions: ['x'] },
        { id: 'kept', question: 'Another?' },
      ],
    })!;
    expect(result.questions.map((q) => q.question)).toEqual(['Real one?', 'Another?']);
    expect(result.questions[0].id).toBe('q1');
    expect(result.questions[1].id).toBe('kept');
    expect(result.questions[0].suggestions).toEqual([]);
  });

  it('tolerates alternative suggestion keys', () => {
    const a = normalizeClarifyResult({ questions: [{ question: 'Q?', options: ['x', 'y'] }] })!;
    expect(a.questions[0].suggestions).toEqual(['x', 'y']);
    const b = normalizeClarifyResult({ questions: [{ question: 'Q?', answers: ['z'] }] })!;
    expect(b.questions[0].suggestions).toEqual(['z']);
  });

  it('rejects junk', () => {
    expect(normalizeClarifyResult(null)).toBeNull();
    expect(normalizeClarifyResult('nope')).toBeNull();
    expect(normalizeClarifyResult({})).toBeNull();
    expect(normalizeClarifyResult({ questions: [] })).toBeNull();
    expect(normalizeClarifyResult({ questions: [{ id: 'x' }] })).toBeNull();
  });
});

describe('parseClarifyContent', () => {
  it('parses plain JSON', () => {
    const content = JSON.stringify({
      questions: [{ id: 'a', question: 'Why?', suggestions: ['x', 'y', 'z'] }],
    });
    expect(parseClarifyContent(content).questions[0].question).toBe('Why?');
  });

  it('strips markdown fences', () => {
    const content = '```json\n{"questions":[{"id":"a","question":"Why?","suggestions":["x"]}]}\n```';
    expect(parseClarifyContent(content).questions).toHaveLength(1);
  });

  it('throws GroqError(PARSE) on schema mismatch', () => {
    expect(() => parseClarifyContent('{"foo": 1}')).toThrowError(/schema/);
  });
});
