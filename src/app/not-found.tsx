import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto mt-24 max-w-md text-center">
      <h1 className="text-lg font-semibold text-stone-900">Not found</h1>
      <p className="mt-2 text-sm text-stone-600">That record does not exist, or it is not available to your role at this property.</p>
      <Link href="/" className="mt-5 inline-block text-sm font-medium text-brand-700 hover:underline">Back to Ask</Link>
    </main>
  );
}
