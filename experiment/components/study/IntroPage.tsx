'use client';

import { useSearchParams } from 'next/navigation';
import { useAtom } from 'jotai';
import { log } from '@/lib/logging';
import { getBrowserMetadata } from '@/lib/browserMetadata';
import { STUDY_PAGES } from '@/lib/studyConfig';
import { studyParamsAtom, updateStudyParamsAtom } from '@/contexts/StudyContext';

export default function IntroPage() {
  const searchParams = useSearchParams();
  const [studyParams, updateParams] = useAtom(updateStudyParamsAtom);

  const handleStartStudy = async () => {
    const username = searchParams.get('username') || '';
    const browserMetadata = getBrowserMetadata();

    // Log the start event with browser metadata
    await log({
      username,
      event: 'Started Study',
      extra_data: browserMetadata,
    });

    // Update params and navigate
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', STUDY_PAGES[2]); // Next page is 'intro-survey'
    window.location.href = `/study?${params.toString()}`;
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-6">Welcome to the Study</h1>

      <div className="space-y-6 mb-8">
        <section>
          <h2 className="text-2xl font-semibold mb-3">Overview</h2>
          <p className="text-gray-700 mb-4">
            Thank you for participating in this research study about AI writing
            assistance. Your contributions will help us understand how writers
            interact with AI tools.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">What You&rsquo;ll Do</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-700">
            <li>Complete a brief questionnaire about your background</li>
            <li>Write an email response based on provided context</li>
            <li>
              You may receive AI suggestions depending on your assigned
              condition
            </li>
            <li>Complete a follow-up questionnaire about your experience</li>
          </ol>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Time Estimate</h2>
          <p className="text-gray-700">
            The entire study should take approximately 15-20 minutes.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-3">Your Data</h2>
          <p className="text-gray-700">
            Your writing and responses will be recorded for research purposes.
            We will not collect any personally identifying information.
          </p>
        </section>
      </div>

      <button
        type="button"
        onClick={handleStartStudy}
        className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
      >
        Start Study
      </button>
    </div>
  );
}
