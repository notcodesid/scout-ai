export default function DocumentPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-800 font-mono text-[13.5px] leading-relaxed lowercase selection:bg-zinc-200 selection:text-black">
      {/* document body */}
      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        {/* document header */}
        <header className="mb-10">
          <div className="text-xs text-zinc-400 tracking-widest mb-2">
            document // specification &amp; theory
          </div>
          <h1 className="text-[15px] text-zinc-900 font-normal">
            how to get hired — the scout&apos;s thesis
          </h1>
        </header>

        {/* article document content */}
        <article className="space-y-6">
          <p className="text-zinc-800 leading-relaxed">
            the game is broken on both sides. a job post gets 200+ applications. the founder can&apos;t tell anyone apart, so they filter by pedigree and keywords. the candidate hears nothing, so they apply to 200 more. both sides optimize for volume — and volume is what makes hiring feel like a lottery. the way out isn&apos;t better volume. it&apos;s refusing to play the volume game.
          </p>

          <p className="text-zinc-800 leading-relaxed">
            think like the person doing the hiring. a founder making a hire is placing a bet: months of salary, team time, momentum. everything in hiring is about reducing the risk of that bet. resumes don&apos;t reduce risk — everyone looks good on paper. interviews barely do — they&apos;re theater. what reduces risk is evidence: you&apos;ve already done the work, you already understand the problem, you&apos;ve already acted like part of the team. the candidate&apos;s job is simple: make the bet feel safe before it&apos;s even offered.
          </p>

          <p className="text-zinc-800 leading-relaxed">
            the urgency objection. &ldquo;take your time&rdquo; sounds like advice for people with savings. most people mass-apply because they&apos;re scared — rent is due. so the reframe: this isn&apos;t about moving slow, it&apos;s about concentrating force. the same 20 hours, either sprayed across 100 applications or aimed at 10 companies with depth. ten deep beats a hundred shallow — and gets you to an offer faster, because each deep attempt has a real chance instead of a lottery ticket&apos;s.
          </p>

          <div className="pt-2 text-zinc-900">
            the four moves.
          </div>

          <p className="text-zinc-800 leading-relaxed">
            1. pick few, go deep. find ten companies you&apos;d actually want to work at. learn how they make money, use their product, read what their founders say. conviction is rare enough to be memorable. failure mode: you pick wrong and miss everything else. guard: the pipeline stays alive — the scout keeps feeding fresh matches, so focus never becomes blindness.
          </p>

          <p className="text-zinc-800 leading-relaxed">
            2. show up with value, not words. find something small and real — a bug, a confusing onboarding step, a slow page — and bring it fixed or clearly diagnosed. you&apos;ve just had your first week before the interview. failure mode: free labor, stolen ideas. guard: give insight, not labor. never a week of unpaid work. if they ask for more before an offer, that&apos;s data about them.
          </p>

          <p className="text-zinc-800 leading-relaxed">
            3. act like you already work there. don&apos;t wait for a ticket. suggest the improvement, name the opportunity they haven&apos;t seen. the person who doesn&apos;t need managing is the scarcest hire there is. failure mode: you come off spammy. guard: specificity is the line. &ldquo;i love your product, let&apos;s chat&rdquo; is spam. &ldquo;your checkout drops 30% of mobile users at step 3, here&apos;s why&rdquo; is a gift. only reach out when you have something real.
          </p>

          <p className="text-zinc-800 leading-relaxed">
            4. prove it with work, not interviews. a small, bounded piece of real work before hiring is the highest-signal thing on either side of the table. failure mode: trial creep — &ldquo;just one more task.&rdquo; guard: trials are small and time-boxed by default. scope creep is a red flag about the company, and the product should tell you that.
          </p>

          <p className="text-zinc-800 leading-relaxed pt-2">
            the bet. hiring will always be a bet. the volume game tries to win it with more tickets. the scout&apos;s game wins it by making the bet safe — evidence over promises, depth over breadth, proof over performance. it&apos;s the only strategy where the best candidate actually wins.
          </p>

          <div className="pt-4 text-zinc-800">
            until then,<br />
            siddharth
          </div>
        </article>
      </main>
    </div>
  );
}
