'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { log } from '@/lib/logging';
import { CONSENT_FORM_URL, getNextPage } from '@/lib/studyConfig';

export default function ConsentPage() {
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLaunchConsent = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    // Log the event
    await log({
      username: searchParams.get('username') || 'unknown',
      event: 'launchConsentForm',
    });

    // Build redirect URL with study parameters
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', getNextPage('consent')!);
    const redirectUrl = `${window.location.origin}/study?${params.toString()}`;

    // Redirect to external consent form with return URL
    const consentUrl = new URL(CONSENT_FORM_URL);
    consentUrl.searchParams.set('redirect_url', redirectUrl);
    window.location.href = consentUrl.toString();
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Informed Consent Form</h1>

      <div className="bg-gray-50 p-6 rounded-lg space-y-4 mb-8 text-sm text-gray-700">
        <p>
          <strong>Purpose:</strong> This study investigates how AI writing
          assistance affects the writing process.
        </p>

        <p>
          <strong>Procedure:</strong> Your participation entails performing a writing task using a system that offers AI-generated suggestions. You may or may not receive AI suggestions
          depending on the condition you are assigned to.
        </p>

        <p>
          <strong>Time Commitment:</strong> Approximately 20-30 minutes.
        </p>

        <p>
          <strong>Risks:</strong> Minimal. No sensitive data will be collected.
        </p>

        <p>
          <strong>Compensation:</strong> $5 upon study completion.
        </p>

        <p>
          <strong>Confidentiality:</strong> Your responses will be anonymized
          and stored securely.
        </p>

        <p>
          <strong>Voluntary Participation:</strong> Your participation is
          completely voluntary. You can withdraw at any time without penalty.
        </p>
      </div>

      <button
        type='button'
        onClick={handleLaunchConsent}
        disabled={isSubmitting}
        className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-blue-400 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Loading...' : 'View Full Consent Form'}
      </button>

      <p className="text-xs text-gray-500 mt-4 text-center">
        Clicking above will take you to the full consent form. After consenting,
        you will return here to proceed with the study.
      </p>
    </div>
  );
}
