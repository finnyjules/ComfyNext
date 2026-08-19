<!-- frontend/app/pages/terms.vue -->
<script setup lang="ts">
</script>

<template>
  <LegalShell title="Terms of Service" updated="August 19, 2026">
    <section>
      <h2>Who we are, and what agreeing means</h2>
      <p>
        Sailor is operated by Julien, as a sole proprietor — there's no separate legal entity behind it yet.
        By creating an account you're agreeing to these Terms, along with our
        <NuxtLink to="/privacy" class="hover:underline">Privacy Policy</NuxtLink> and
        <NuxtLink to="/content-policy" class="hover:underline">Content Policy</NuxtLink>.
      </p>
    </section>

    <section>
      <h2>This is a beta</h2>
      <p>
        Sailor is a private beta. Features will change, things will break, and we're not making any promise
        about uptime or that the service will fit a particular purpose. We can suspend or end your access at
        any time, for any reason.
      </p>
    </section>

    <section>
      <h2>Credits</h2>
      <ul>
        <li>Generations run on prepaid credits. New accounts get a starting grant to try things out.</li>
        <li>Purchased credits are charged through Stripe.</li>
        <li>The credit cost of a generation can change at any time — we show the price before you run it.</li>
        <li>Credits aren't redeemable for cash and are non-refundable, except where the law requires a refund.</li>
        <li>
          Credits do not currently expire. We reserve the right to introduce expiry for future credit grants,
          with at least 30 days' notice before it applies.
        </li>
      </ul>
    </section>

    <section>
      <h2>Your content</h2>
      <p>
        You own the outputs you generate. To whatever extent we hold any rights in them, we assign those
        rights to you. You're responsible for your prompts and uploads, and you need to have the rights to
        anything you upload. In return, you grant us the limited license we need to process, store, and
        display your content back to you so the service can work.
      </p>
    </section>

    <section>
      <h2>Acceptable use</h2>
      <p>
        Use of Sailor is governed by our <NuxtLink to="/content-policy" class="hover:underline">Content Policy</NuxtLink>.
        Prompts are screened automatically, and prompts that violate the policy can be blocked before generation.
        Abuse of the service can end your access.
      </p>
    </section>

    <section>
      <h2>Liability</h2>
      <p>
        The service is provided "as is." To the maximum extent the law allows, our total liability to you is
        capped at the amount you paid us in the past three months.
      </p>
    </section>

    <section>
      <h2>Changes and contact</h2>
      <p>
        We can update these terms; we'll give notice before any material change takes effect. Questions go to
        <a href="mailto:hello@madebyjulien.com" class="hover:underline">hello@madebyjulien.com</a>.
      </p>
    </section>
  </LegalShell>
</template>
