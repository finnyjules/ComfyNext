<!-- frontend/app/pages/content-policy.vue -->
<script setup lang="ts">
</script>

<template>
  <LegalShell title="Content Policy" updated="August 19, 2026">
    <section>
      <p>
        Every prompt is automatically screened before generation. If a prompt violates this policy, it's
        blocked before anything runs, and you aren't charged for it.
      </p>
    </section>

    <section>
      <h2>What's prohibited</h2>
      <ul>
        <li>Sexual content involving minors — absolute, zero tolerance, no exceptions.</li>
        <li>Non-consensual sexual content.</li>
        <li>Hate speech and harassment.</li>
        <li>Credible threats or incitement of violence.</li>
        <li>Content that promotes self-harm.</li>
        <li>Facilitation of illicit activity.</li>
      </ul>
    </section>

    <section>
      <h2>Enforcement</h2>
      <p>
        Blocked prompts are logged. Repeated, deliberate attempts to get around the screening can end your
        access during the beta.
      </p>
    </section>

    <section>
      <h2>Appeals</h2>
      <p>
        Think a prompt was blocked by mistake? Email
        <a href="mailto:hello@madebyjulien.com" class="hover:underline">hello@madebyjulien.com</a>. Beta
        moderation is imperfect and deliberately fails open, so mistakes on both sides are expected — we'd
        rather hear about them than have you stuck.
      </p>
    </section>
  </LegalShell>
</template>
