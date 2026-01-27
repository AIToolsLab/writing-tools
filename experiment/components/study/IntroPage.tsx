'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBrowserMetadata } from '@/lib/browserMetadata';
import { log } from '@/lib/logging';
import { getNextPage } from '@/lib/studyConfig';

export default function IntroPage() {
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStartStudy = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
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
    params.set('page', getNextPage('intro')!);
    window.location.href = `/study?${params.toString()}`;
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
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
            <li>Write an email message. We&apos;ll walk you through the task step-by-step.
            </li>
            <li>Complete a follow-up questionnaire about your experience</li>
          </ol>
        </section>
      </div>

      <button
        type="button"
        onClick={handleStartStudy}
        disabled={isSubmitting}
        className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-400 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Loading...' : 'On to the Intro Survey →'}
      </button>
    </div>
  );
}
