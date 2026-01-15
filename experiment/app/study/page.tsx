'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAtom } from 'jotai';
import { log } from '@/lib/logging';
import {
  DEFAULT_AUTO_REFRESH_INTERVAL,
  DEFAULT_SCENARIO_ID,
  VALID_CONDITIONS,
  type letterToCondition,
} from '@/lib/studyConfig';
import type { LogEventType, StudyParams } from '@/types/study';
import { studyParamsAtom } from '@/contexts/StudyContext';
import ScreenSizeCheck from '@/components/study/ScreenSizeCheck';
import ConsentPage from '@/components/study/ConsentPage';
import IntroPage from '@/components/study/IntroPage';
import IntroSurvey from '@/components/study/IntroSurvey';
import StartTaskPage from '@/components/study/StartTaskPage';
import TaskPage from '@/components/study/TaskPage';
import PostTaskSurvey from '@/components/study/PostTaskSurvey';
import FinalPage from '@/components/study/FinalPage';

const pageComponents = {
  consent: ConsentPage,
  intro: IntroPage,
  'intro-survey': IntroSurvey,
  'start-task': StartTaskPage,
  task: TaskPage,
  'post-task-survey': PostTaskSurvey,
  final: FinalPage,
} as const;

type PageKey = keyof typeof pageComponents;

// Returns a StudyParams object or an error string
function parseStudyParams(searchParams: URLSearchParams): StudyParams | string {
  const username = searchParams.get('username') || '';
  if (username.length === 0 || !/^[a-zA-Z0-9\-_]+$/.test(username)) {
    return 'Invalid username: must be alphanumeric with dashes/underscores';
  }

  const conditionStr = searchParams.get('condition');
  if (!conditionStr || !(VALID_CONDITIONS as readonly string[]).includes(conditionStr)) {
    return `Invalid condition: "${conditionStr ?? 'missing'}". Valid: ${VALID_CONDITIONS.join(', ')}`;
  }

  const page = searchParams.get('page') || 'consent';
  if (!(page in pageComponents)) {
    return `Invalid page: "${page}". Valid: ${Object.keys(pageComponents).join(', ')}`;
  }

  const experiment = searchParams.get('experiment');
  const autoRefreshStr = searchParams.get('autoRefreshInterval');

  return {
    username,
    condition: conditionStr as keyof typeof letterToCondition,
    page,
    experiment: experiment === 'type' ? 'type' : 'amount',
    isProlific: searchParams.get('isProlific') === 'true',
    autoRefreshInterval: autoRefreshStr ? parseInt(autoRefreshStr, 10) : DEFAULT_AUTO_REFRESH_INTERVAL,
    scenario: searchParams.get('scenario') || DEFAULT_SCENARIO_ID
  };
}

function StudyRouter() {
  const searchParams = useSearchParams();
  const [, setStudyParams] = useAtom(studyParamsAtom);

  const paramsOrError = parseStudyParams(searchParams);

  // Update study params atom and log page view
  useEffect(() => {
    if (typeof paramsOrError === 'string') return;
    const studyParams = paramsOrError;

    setStudyParams(studyParams);

    log({
      username: studyParams.username,
      event: `view:${studyParams.page}` as LogEventType,
      extra_data: { studyParams },
    }).catch((e) => console.error('Failed to log page view:', e));
  }, [paramsOrError, setStudyParams]);

  // Error state
  if (typeof paramsOrError === 'string') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Invalid Parameters</h1>
          <p className="text-gray-700 mb-4">{paramsOrError}</p>
          <a
            href="/study?page=consent&username=test&condition=a&scenario=roomDoubleBooking"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Test URL
          </a>
        </div>
      </div>
    );
  }

  // TypeScript knows paramsOrError is StudyParams here
  const PageComponent = pageComponents[paramsOrError.page as PageKey];

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
