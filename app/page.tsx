import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("admin_users")
    .select("*", { count: "exact", head: true });

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-4xl font-bold">Events Hub</h1>
        <p className="text-sm text-neutral-500">
          Leadership Communication Group
        </p>
        <div className="mt-8 p-4 border rounded-lg">
          {error ? (
            <div className="text-red-600">
              <p className="font-semibold">Supabase connection failed</p>
              <p className="text-sm mt-2">{error.message}</p>
            </div>
          ) : (
            <div className="text-green-700">
              <p className="font-semibold">Schema deployed</p>
              <p className="text-xs text-neutral-500 mt-2">
                {count} admin {count === 1 ? "user" : "users"} seeded
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
