/**
 * Landing / index page for the experiment app.
 *
 * This is intentionally NOT the study task. The real study lives at /study and
 * requires URL parameters (username, condition, ...). The /demo route hosts the
 * standalone AI-suggestions demo (no chat), which is also not part of the study.
 */

import Link from 'next/link';

const STUDY_TEST_URL =
  '/study?page=consent&username=test&condition=a&scenario=roomDoubleBooking';

export default function Home() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-6">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-xl w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Measuring Thinking — Experiment App
        </h1>
        <p className="text-gray-700 mb-6">
          This is the development landing page. Pick where you want to go.
        </p>

        <div className="space-y-4">
          <div className="border border-gray-200 rounded p-4">
            <h2 className="font-semibold text-gray-900 mb-1">The study</h2>
            <p className="text-sm text-gray-600 mb-3">
              The real study runs at <code className="text-gray-800">/study</code> and
              requires URL parameters (<code className="text-gray-800">username</code>,{' '}
              <code className="text-gray-800">condition</code>, etc.). Participants reach
              it through the consent flow.
            </p>
            <Link
              href={STUDY_TEST_URL}
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Open study (test URL)
            </Link>
          </div>

          <div className="border border-gray-200 rounded p-4">
            <h2 className="font-semibold text-gray-900 mb-1">Standalone demo</h2>
            <p className="text-sm text-gray-600 mb-3">
              A standalone AI writing-suggestions demo with{' '}
              <strong>no colleague chat</strong>. It is not part of the study and logs
              nothing — useful for poking at the AI panel in isolation.
            </p>
            <Link
              href="/demo"
              className="inline-block px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-800"
            >
              Open demo
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
