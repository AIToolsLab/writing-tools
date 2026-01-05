'use client';

import { useSearchParams } from 'next/navigation';
import { log, logThenRedirect } from '@/lib/logging';
import { getNextPage } from '@/lib/studyConfig';

export default function StartTaskPage() {
  const searchParams = useSearchParams();
  const username = searchParams.get('username') || '';

  const handleStartTask = async () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', getNextPage('start-task')!);
    const nextUrl = `/study?${params.toString()}`;

    await logThenRedirect(
      {
        username,
        event: 'taskStart',
      },
      nextUrl
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Writing Task</h1>

      <div className="bg-blue-50 p-6 rounded-lg mb-8 space-y-4 text-gray-800">
        <h2 className="text-xl font-semibold">Task Instructions</h2>

        <div>
          <h3 className="font-semibold mb-2">Scenario:</h3>
          <p>
            You have received an email from a colleague asking for advice on a
            project. Please write a thoughtful email response to address their
            questions and provide helpful feedback.
          </p>
        </div>

        <div>
          <h3 className="font-semibold mb-2">What to do:</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Read the context carefully</li>
            <li>
              Compose your email response in the text area provided
            </li>
            <li>
              Depending on your condition, you may see AI-generated suggestions
            </li>
            <li>
              Use the suggestions if helpful, or write your own content as you
              prefer
            </li>
            <li>
              When you're satisfied with your response, click the "Send" button
            </li>
          </ol>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Tips:</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>There's no "perfect" response - write naturally</li>
            <li>Take as much time as you need</li>
            <li>
              If you encounter any issues, please note them in the final
              survey
            </li>
          </ul>
        </div>
      </div>

      <button
        onClick={handleStartTask}
        className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
      >
        Start Writing Task
      </button>
    </div>
  );
}
