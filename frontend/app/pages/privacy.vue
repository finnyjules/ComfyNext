<!-- frontend/app/pages/privacy.vue -->
<script setup lang="ts">
</script>

<template>
  <LegalShell title="Privacy Policy" updated="August 19, 2026">
    <section>
      <h2>What we collect</h2>
      <ul>
        <li>Your account email and sign-in identity, handled through Clerk.</li>
        <li>Your prompts, uploads, saved projects, and the outputs you generate.</li>
        <li>A credit ledger recording your generation activity.</li>
        <li>Error reports — with prompt text removed before they're sent.</li>
      </ul>
    </section>

    <section>
      <h2>Who we share it with</h2>
      <p>We use a small set of outside services to run Sailor. Each only gets what it needs to do its job:</p>
      <ul>
        <li><strong>Clerk</strong> — handles accounts and sign-in.</li>
        <li><strong>Stripe</strong> — handles payments. Sailor never sees your card number.</li>
        <li><strong>Neon</strong> — our database. Stores your account email, credit ledger, and generation records.</li>
        <li><strong>Sentry</strong> — receives error reports, with prompt text scrubbed out first.</li>
        <li>
          <strong>Generation providers</strong> (Replicate, fal.ai, Anthropic) — receive your prompt text to run
          the generation you asked for.
        </li>
        <li>
          <strong>OpenAI moderation</strong> — receives your prompt text to screen it for safety before
          generation. Image data is not sent to the moderation service.
        </li>
      </ul>
    </section>

    <section>
      <h2>What we don't do</h2>
      <p>
        We don't sell your personal data, we don't run ad tracking, and we don't collect analytics beyond
        what's needed to operate the service.
      </p>
    </section>

    <section>
      <h2>Retention and deletion</h2>
      <p>
        We keep your content while your account is active. To delete your account and data, email
        <a href="mailto:hello@madebyjulien.com" class="hover:underline">hello@madebyjulien.com</a>.
      </p>
    </section>

    <section>
      <h2>Beta caveat</h2>
      <p>
        During the beta, the operator may access stored content for debugging purposes. We take care to touch
        only what's needed to investigate an issue.
      </p>
    </section>
  </LegalShell>
</template>
