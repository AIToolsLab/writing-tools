'use client';

import { useSearchParams } from 'next/navigation';
import { COMPLETION_CODE } from '@/lib/studyConfig';

export default function FinalPage() {
  const searchParams = useSearchParams();
  const isProlific = searchParams.get('isProlific') === 'true';

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6 text-green-600">
        Thank You!
      </h1>

      <div className="space-y-6">
        <section>
          <p className="text-lg text-gray-700">
            Thank you for completing this research study. Your responses and
            writing sample have been recorded and will be used to improve our
            understanding of how writers interact with AI assistance.
          </p>
        </section>

        {isProlific && (
          <section className="bg-green-50 p-6 rounded-lg border border-green-200">
            <h2 className="text-xl font-semibold mb-3 text-green-800">
              Prolific Study Completion
            </h2>
            <p className="text-gray-700 mb-3">
              Your study completion code is:
            </p>
            <div className="bg-white p-4 rounded font-mono text-center text-xl font-bold text-green-600 border-2 border-green-300 mb-3">
              {COMPLETION_CODE}
            </div>
            <p className="text-sm text-gray-600">
              Please enter this code in Prolific to confirm your completion and
              receive payment.
            </p>
          </section>
        )}

        <section>
          <h2 className="text-xl font-semibold mb-3">Next Steps</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            {isProlific ? (
              <li>Return to Prolific and submit the code above</li>
            ) : (
              <li>Your data has been recorded</li>
            )}
            <li>
              If you have any questions, please contact the research team
            </li>
            <li>
              Your anonymous data will be used to improve AI writing tools
            </li>
          </ul>
        </section>

        <section className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-600">
            This research was conducted by the <a href="https://thoughtful-ai.com/">Thoughtful AI Lab</a> at Calvin University. For questions
            about this study, please contact ken.arnold@calvin.edu.
          </p>
        </section>
      </div>
    </div>
  );
}
