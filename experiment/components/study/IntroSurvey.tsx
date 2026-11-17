'use client';

import { useAtom, useAtomValue } from 'jotai';
import { logThenRedirect } from '@/lib/logging';
import { getScenario, letterToCondition } from '@/lib/studyConfig';
import { studyParamsAtom, surveyInputAtom } from '@/contexts/StudyContext';
import Survey from '@/components/survey/Survey';
import { introSurveySections } from '@/components/survey/surveyData';
import { useNextPageUrl } from './useNextPage';

export default function IntroSurvey() {
  const studyParams = useAtomValue(studyParamsAtom);
  const nextUrl = useNextPageUrl();
  const [surveyInputs] = useAtom(surveyInputAtom);
  const username = studyParams.username;
  const conditionCode = studyParams.condition;
  const condition = letterToCondition[conditionCode];
  // getScenario resolves a missing or unknown ID to the default scenario
  const scenarioId = getScenario(studyParams.scenario).id;

  const handleSubmit = async () => {
    // Log survey completion
    await logThenRedirect(
      {
        username,
        event: 'surveyComplete:intro-survey',
        extra_data: { scenarioId, condition, answers: surveyInputs },
      },
      nextUrl,
    );
  };

  return (
    <div className='max-w-2xl mx-auto p-8'>
      <Survey
        title='Background Information'
        sections={introSurveySections}
        onSubmit={handleSubmit}
        submitButtonText='Continue to Task'
      />
    </div>
  );
}
