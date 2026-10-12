import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { createClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMagicSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head><title>ClipMemeEditor — Sign in</title></Head>
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="text-2xl font-black text-white tracking-tight mb-1">
              Clip<span className="text-[#ff4444]">MemeEditor</span>
            </div>
            <p className="text-[#555] text-sm">Clip · Caption · Meme</p>
          </div>

          {magicSent ? (
            <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-6 text-center">
              <div className="text-2xl mb-3">📬</div>
              <p className="text-[#ccc] text-sm">Check your email to confirm your account, then sign in.</p>
              <button onClick={() => setMagicSent(false)} className="mt-4 text-[#ff4444] text-xs hover:underline">
                Back to sign in
              </button>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-6">
              {/* Mode tabs */}
              <div className="flex mb-6 bg-[#111] rounded-lg p-1">
                {(["login", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setError(""); }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      mode === m ? "bg-[#ff4444] text-white" : "text-[#555] hover:text-[#888]"
                    }`}
                  >
                    {m === "login" ? "Sign in" : "Sign up"}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-[#111] border border-[#2e2e2e] rounded-lg px-3 py-2 text-sm text-white placeholder-[#444] focus:outline-none focus:border-[#ff4444] transition-colors"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full bg-[#111] border border-[#2e2e2e] rounded-lg px-3 py-2 text-sm text-white placeholder-[#444] focus:outline-none focus:border-[#ff4444] transition-colors"
                />
                {error && <p className="text-[#ff4444] text-xs">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#ff4444] hover:bg-[#cc3333] disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
                >
                  {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
