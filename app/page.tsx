export default function Home() {
  return (
    <main className="thesis-container">
      <article aria-labelledby="thesis-title">
        <header className="thesis-header">
          <h1 id="thesis-title">how to get hired — the scout&apos;s thesis</h1>
        </header>

        <section>
          <p>
            the game is broken on both sides. a job post gets 200+ applications. the founder
            can&apos;t tell anyone apart, so they filter by pedigree and keywords. the candidate
            hears nothing, so they apply to 200 more. both sides optimize for volume — and volume
            is what makes hiring feel like a lottery. the way out isn&apos;t better volume. it&apos;s
            refusing to play the volume game.
          </p>
        </section>

        <section>
          <h2>think like the person doing the hiring</h2>
          <p>
            a founder making a hire is placing a bet: months of salary, team time, momentum.
            everything in hiring is about reducing the risk of that bet. resumes don&apos;t reduce
            risk — everyone looks good on paper. interviews barely do — they&apos;re theater. what
            reduces risk is evidence: you&apos;ve already done the work, you already understand the
            problem, you&apos;ve already acted like part of the team. the candidate&apos;s job is
            simple: make the bet feel safe before it&apos;s even offered.
          </p>
        </section>

        <section>
          <h2>the urgency objection</h2>
          <p>
            &ldquo;take your time&rdquo; sounds like advice for people with savings. most people
            mass-apply because they&apos;re scared — rent is due. so the reframe: this isn&apos;t
            about moving slow, it&apos;s about concentrating force. the same 20 hours, either
            sprayed across 100 applications or aimed at 10 companies with depth. ten deep beats a
            hundred shallow — and gets you to an offer faster, because each deep attempt has a real
            chance instead of a lottery ticket&apos;s.
          </p>
        </section>

        <section>
          <h2>the four moves</h2>

          <div className="move-block">
            <h3>1. pick few, go deep</h3>
            <p>
              find ten companies you&apos;d actually want to work at. learn how they make money, use
              their product, read what their founders say. conviction is rare enough to be
              memorable. failure mode: you pick wrong and miss everything else.
            </p>
            <div className="thesis-guard">
              <strong>guard:</strong> the pipeline stays alive — the scout keeps feeding fresh
              matches, so focus never becomes blindness.
            </div>
          </div>

          <div className="move-block">
            <h3>2. show up with value, not words</h3>
            <p>
              find something small and real — a bug, a confusing onboarding step, a slow page — and
              bring it fixed or clearly diagnosed. you&apos;ve just had your first week before the
              interview. failure mode: free labor, stolen ideas.
            </p>
            <div className="thesis-guard">
              <strong>guard:</strong> give insight, not labor. never a week of unpaid work. if
              they ask for more before an offer, that&apos;s data about them.
            </div>
          </div>

          <div className="move-block">
            <h3>3. act like you already work there</h3>
            <p>
              don&apos;t wait for a ticket. suggest the improvement, name the opportunity they
              haven&apos;t seen. the person who doesn&apos;t need managing is the scarcest hire there
              is. failure mode: you come off spammy.
            </p>
            <div className="thesis-guard">
              <strong>guard:</strong> specificity is the line. &ldquo;i love your product,
              let&apos;s chat&rdquo; is spam. &ldquo;your checkout drops 30% of mobile users at step
              3, here&apos;s why&rdquo; is a gift. only reach out when you have something real.
            </div>
          </div>

          <div className="move-block">
            <h3>4. prove it with work, not interviews</h3>
            <p>
              a small, bounded piece of real work before hiring is the highest-signal thing on
              either side of the table. failure mode: trial creep — &ldquo;just one more task.&rdquo;
            </p>
            <div className="thesis-guard">
              <strong>guard:</strong> trials are small and time-boxed by default. scope creep is a
              red flag about the company, and the product should tell you that.
            </div>
          </div>
        </section>

        <section>
          <h2>the bet</h2>
          <p>
            hiring will always be a bet. the volume game tries to win it with more tickets. the
            scout&apos;s game wins it by making the bet safe — evidence over promises, depth over
            breadth, proof over performance. it&apos;s the only strategy where the best candidate
            actually wins.
          </p>
        </section>

        <div className="thesis-footer">
          <p>until then,</p>
          <p>scout</p>
        </div>
      </article>
    </main>
  );
}
