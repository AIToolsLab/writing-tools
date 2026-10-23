'use client';

import { useSearchParams } from 'next/navigation';
import { useAtom } from 'jotai';
import { log, logThenRedirect } from '@/lib/logging';
import { getNextPage, getScenario, letterToCondition } from '@/lib/studyConfig';
import { surveyInputAtom } from '@/contexts/StudyContext';
import Survey from '@/components/survey/Survey';
import {
  getPostTaskSurveySections,
  conditionDebriefs,
} from '@/components/survey/surveyData';

export default function PostTaskSurvey() {
  const searchParams = useSearchParams();
  const [surveyInputs] = useAtom(surveyInputAtom);
  const username = searchParams.get('username') || '';
  const conditionCode = (searchParams.get('condition') || 'n') as keyof typeof letterToCondition;
  const condition = letterToCondition[conditionCode];
  // getScenario resolves a missing or unknown ID to the default scenario
  const scenarioId = getScenario(searchParams.get('scenario') || undefined).id;

  const surveySections = getPostTaskSurveySections(condition, scenarioId);
  const debrief = conditionDebriefs[condition];

  const handleSubmit = async () => {
    // Log survey completion
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', getNextPage('post-task-survey')!);
    const nextUrl = `/study?${params.toString()}`;

    await logThenRedirect(
      {
        username,
        event: 'surveyComplete:post-task-survey',
        extra_data: surveyInputs,
      },
      nextUrl
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <Survey
        title="Task Completion Survey"
        description="Please tell us about your experience with the writing task."
        sections={surveySections}
        onSubmit={handleSubmit}
        submitButtonText="Continue"
      >
        {debrief && (
          <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
            <h3 className="font-semibold text-blue-900 mb-2">
              {debrief.title}
            </h3>
            <p className="text-blue-800 text-sm">{debrief.content}</p>
          </div>
        )}
      </Survey>
    </div>
  );
}
