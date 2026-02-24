export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-2xl mx-auto px-6 py-12 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Writing Tools
        </h1>
        <p className="text-xl text-gray-700 mb-8">
          AI-powered writing assistance integrated with Microsoft Word
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="/editor"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Demo Editor
          </a>
          <a
            href="/taskpane"
            className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Word Add-in
          </a>
        </div>
        <div className="mt-12 text-sm text-gray-600">
          <p>
            This is a Next.js migration of the writing-tools application.
          </p>
          <p className="mt-2">
            Features: AI suggestions, chat assistance, document analysis, and user study mode.
          </p>
        </div>
      </div>
    </div>
  );
}
