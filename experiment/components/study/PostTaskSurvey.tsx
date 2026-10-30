'use client';

import { useAtom, useAtomValue } from 'jotai';
import { logThenRedirect } from '@/lib/logging';
import { getScenario, letterToCondition } from '@/lib/studyConfig';
import { studyParamsAtom, surveyInputAtom } from '@/contexts/StudyContext';
import Survey from '@/components/survey/Survey';
import { getPostTaskSurveySections } from '@/components/survey/surveyData';
import { useNextPage } from './useNextPage';

export default function PostTaskSurvey() {
  const studyParams = useAtomValue(studyParamsAtom);
  const getNextUrl = useNextPage('post-task-survey');
  const [surveyInputs] = useAtom(surveyInputAtom);
  const username = studyParams.username;
  const conditionCode = studyParams.condition;
  const condition = letterToCondition[conditionCode];
  // getScenario resolves a missing or unknown ID to the default scenario
  const scenarioId = getScenario(studyParams.scenario).id;

  const surveySections = getPostTaskSurveySections(condition, scenarioId);

  const handleSubmit = async () => {
    // Log survey completion
    await logThenRedirect(
      {
        username,
        event: 'surveyComplete:post-task-survey',
        extra_data: { scenarioId, condition, answers: surveyInputs },
      },
      getNextUrl(),
    );
  };

  return (
    <div className='max-w-2xl mx-auto p-8'>
      <Survey
        title='Task Completion Survey'
        sections={surveySections}
        onSubmit={handleSubmit}
        submitButtonText='Continue'
      />
    </div>
  );
}
