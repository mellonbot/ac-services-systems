import { html, type VNode } from "../../../../packages/ui/src/index.ts";
import type { CoverageOutput } from "../../../../packages/contracts/src/index.ts";
import { coverage, whenReady, submitAction, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * THE LEAD FORM — the one thing this surface is for.
 *
 * Four decisions worth stating, because each is the sort that gets reversed
 * by someone optimising a funnel:
 *
 * 1. THE BUTTON DOES NOT CHECK WHETHER THE GATEWAY IS UP. It queues. The
 *    difference between this surface and every other one is in
 *    `submitAction`'s comment; what it means here is that the form is always
 *    submittable and the page is always honest about what happened to it.
 *
 * 2. THE PAGE NEVER SAYS "SENT" UNTIL IT IS. A queued form says queued, in
 *    those words, with what will happen next. Telling a stranger we have
 *    their number when the request is sitting in their own browser's storage
 *    is how an outage becomes a customer who waited and then called someone
 *    else.
 *
 * 3. THE METRO FIELD IS A FREE-TEXT SUGGESTION, NOT A PICKER BOUND TO
 *    COVERAGE. A datalist offers what we serve; typing something else is
 *    allowed and the lead is taken. A form that refuses an address outside
 *    the current map is a form that cannot tell us where demand is, and the
 *    coverage map is exactly the thing that is supposed to change.
 *
 * 4. NO REQUIRED FIELD WE DO NOT NEED. A name, and one way to reach them.
 *    Everything else is optional. The gateway refuses a lead with no email
 *    and no phone — `no_way_to_answer` — because that is a row nobody can
 *    act on, and the form says so before the button rather than after it.
 */
export const enquire: Screen = (ctx: ScreenContext): VNode => {
  const cov = coverage(ctx);
  const queued = ctx.buffer.pending.value;
  const attention = ctx.buffer.attention.value;
  const sent = ctx.store.notice.value;

  const onSubmit = (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    ctx.submit({
      name: String(f.get("name") ?? ""),
      email: String(f.get("email") ?? ""),
      phone: String(f.get("phone") ?? ""),
      note: String(f.get("note") ?? ""),
      metro: String(f.get("metro") ?? ""),
      source: "web_form",
    });
    form.reset();
  };

  return html`<section class="s1-enquire">
    <h1 class="s1-h1">Ask us to call</h1>
    <p class="s1-lede">
      Leave a name and one way to reach you. The office for your area picks it
      up; we will tell you what we can do before anyone commits to anything.
    </p>

    ${sent.length ? html`<section class="s1-sent" role="status" id="sent">
      <p>${sent[sent.length - 1]}</p>
    </section>` : null}

    ${queued.length ? html`<section class="s1-queued" role="status" id="queued">
      <p><strong>${queued.length === 1 ? "Your message is waiting to send." : `${queued.length} messages are waiting to send.`}</strong></p>
      <p>
        We could not reach our system just now, so it is being held on this
        device and will go as soon as the connection is back. Keep this page
        open if you can. If it is urgent, call the number below instead.
      </p>
    </section>` : null}

    ${attention.map((a) => html`<section class="s1-refusal" role="alert" data-kind="input">
      <h2 class="s1-refusal__heading">That did not go through</h2>
      <p class="s1-refusal__message">${a.message}</p>
      <div class="s1-refusal__routes">
        <button type="button" class="ac-action" data-kind="quiet" data-density=${ctx.density}
                onClick=${() => ctx.buffer.dismiss(a.submissionId)}>Dismiss</button>
      </div>
    </section>`)}

    <form class="s1-form" onSubmit=${onSubmit} id="lead-form">
      <label class="s1-field"><span>Your name</span>
        <input class="s1-input" name="name" type="text" required maxlength="120" autocomplete="name" id="lead-name" />
      </label>
      <label class="s1-field"><span>Email <span class="s1-field__hint">— or a phone number below</span></span>
        <input class="s1-input" name="email" type="email" maxlength="254" autocomplete="email" id="lead-email" />
      </label>
      <label class="s1-field"><span>Phone</span>
        <input class="s1-input" name="phone" type="tel" maxlength="40" autocomplete="tel" id="lead-phone" />
      </label>
      <label class="s1-field"><span>Where is the site? <span class="s1-field__hint">— a city is enough</span></span>
        <input class="s1-input" name="metro" type="text" maxlength="80" list="s1-metros" id="lead-metro" />
      </label>
      ${whenReady<CoverageOutput>(ctx, cov, (v) => html`<datalist id="s1-metros">
        ${v.metros.map((m) => html`<option value=${m.name}></option>`)}
      </datalist>`, undefined)}
      <label class="s1-field"><span>What do you need? <span class="s1-field__hint">— optional</span></span>
        <textarea class="s1-input s1-textarea" name="note" maxlength="2000" id="lead-note"></textarea>
      </label>
      ${submitAction(ctx, "Ask us to call", "lead-submit")}
    </form>

    <p class="s1-foot">
      We use what you send here to answer you. ${linkTo(ctx, "coverage", {}, "Where we work")}
    </p>
  </section>`;
};
