'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAtom } from 'jotai';
import { log } from '@/lib/logging';
import {
  STUDY_PAGES,
  VALID_CONDITIONS,
  letterToCondition,
} from '@/lib/studyConfig';
import { studyParamsAtom } from '@/contexts/StudyContext';
import ScreenSizeCheck from '@/components/study/ScreenSizeCheck';
import ConsentPage from '@/components/study/ConsentPage';
import IntroPage from '@/components/study/IntroPage';
import IntroSurvey from '@/components/study/IntroSurvey';
import StartTaskPage from '@/components/study/StartTaskPage';
import TaskPage from '@/components/study/TaskPage';
import PostTaskSurvey from '@/components/study/PostTaskSurvey';
import FinalPage from '@/components/study/FinalPage';

const pageComponents: Record<string, React.ComponentType> = {
  consent: ConsentPage,
  intro: IntroPage,
  'intro-survey': IntroSurvey,
  'start-task': StartTaskPage,
  task: TaskPage,
  'post-task-survey': PostTaskSurvey,
  final: FinalPage,
};

function StudyRouter() {
  const searchParams = useSearchParams();
  const [, setStudyParams] = useAtom(studyParamsAtom);

  // Extract URL parameters
  const page = searchParams.get('page') || 'consent';
  const username = searchParams.get('username') || '';
  const conditionStr = searchParams.get('condition') || 'n';
  const experiment = searchParams.get('experiment');
  const isProlific = searchParams.get('isProlific') === 'true';
  const autoRefreshInterval = searchParams.get('autoRefreshInterval');

  // Validate parameters
  const isValidPage = page in pageComponents;
  const isValidCondition = (
    VALID_CONDITIONS as readonly string[]
  ).includes(conditionStr);
  const isValidUsername =
    username.length > 0 && /^[a-zA-Z0-9\-_]+$/.test(username);

  // Update study params atom
  useEffect(() => {
    if (isValidUsername && isValidCondition) {
      setStudyParams({
        username,
        condition: conditionStr as keyof typeof letterToCondition,
        page,
        experiment: experiment === 'type' ? 'type' : 'amount',
        isProlific,
        autoRefreshInterval: autoRefreshInterval
          ? parseInt(autoRefreshInterval)
          : undefined,
      });

      // Log page view
      log({
        username,
        event: `view:${page}` as any,
      }).catch((e) => console.error('Failed to log page view:', e));
    }
  }, [page, username, conditionStr, experiment, isProlific, autoRefreshInterval, isValidUsername, isValidCondition, setStudyParams]);

  // Error states
  if (!isValidUsername) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">
            Invalid Parameters
          </h1>
          <p className="text-gray-700 mb-4">
            The study URL is missing or invalid parameters.
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Please check that you have a valid study URL with:
          </p>
          <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside mb-4">
            <li>username (alphanumeric, dashes, underscores)</li>
            <li>condition (single letter: n, c, e, a, or p)</li>
            <li>page (optional, defaults to consent)</li>
          </ul>
          <code className="text-xs bg-gray-100 p-2 rounded block mb-4">
            /study?page=consent&username=test&condition=a
          </code>
          <a
            href="/study?page=consent&username=test&condition=a"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Test URL
          </a>
        </div>
      </div>
    );
  }

  if (!isValidCondition) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">
            Invalid Condition
          </h1>
          <p className="text-gray-700 mb-4">
            The condition parameter "{conditionStr}" is invalid.
          </p>
          <p className="text-sm text-gray-600">
            Valid conditions are: n, c, e, a, p
          </p>
        </div>
      </div>
    );
  }

  if (!isValidPage) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">
            Invalid Page
          </h1>
          <p className="text-gray-700 mb-4">
            The page parameter "{page}" is invalid.
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Valid pages are: {STUDY_PAGES.join(', ')}
          </p>
        </div>
      </div>
    );
  }

  // Render the appropriate page component
  const PageComponent = pageComponents[page];

  return (
    <ScreenSizeCheck>
      <PageComponent />
    </ScreenSizeCheck>
  );
}

/**
 * Main study page - wraps router in Suspense boundary for useSearchParams
 */
export default function StudyPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading study...</div>}>
      <StudyRouter />
    </Suspense>
  );
}
