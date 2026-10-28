import { describe, it, expect } from 'vitest';
import {
  introSurveySections,
  getPostTaskSurveySections,
} from '@/components/survey/surveyData';
import type { SurveySection } from '@/components/survey/types';
import { SCENARIOS, letterToCondition } from '@/lib/studyConfig';

// Answers are stored by question id, so a duplicate id would silently
// overwrite another question's answer in the logs.
function questionIds(sections: SurveySection[]): string[] {
  return sections.flatMap((section) => section.questions.map((q) => q.id));
}

function duplicates(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

describe('survey question ids', () => {
  it('are unique in the intro survey', () => {
    expect(duplicates(questionIds(introSurveySections))).toEqual([]);
  });

  const conditions = [...new Set(Object.values(letterToCondition))];
  for (const condition of conditions) {
    for (const scenarioId of Object.keys(SCENARIOS)) {
      it(`are unique in the post-task survey (${condition}, ${scenarioId})`, () => {
        const ids = questionIds(
          getPostTaskSurveySections(condition, scenarioId),
        );
        expect(duplicates(ids)).toEqual([]);
        // "please specify" answers are saved as `${id}_other`
        expect(ids.filter((id) => id.endsWith('_other'))).toEqual([]);
      });
    }
  }
});
