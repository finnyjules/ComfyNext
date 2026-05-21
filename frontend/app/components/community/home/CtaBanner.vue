<script setup>
import { ref, onMounted } from 'vue'
import { useGsap } from '~/composables/community/useGsap.js'

const sectionRef = ref(null)
const headlineRef = ref(null)
const subtextRef = ref(null)
const buttonRef = ref(null)

const { gsap, animate, prefersReducedMotion } = useGsap()

onMounted(() => {
  if (prefersReducedMotion || !sectionRef.value) return

  animate(() => {
    // Gradient angle shift on scroll
    gsap.fromTo(
      sectionRef.value,
      { '--gradient-angle': '135deg' },
      {
        '--gradient-angle': '195deg',
        scrollTrigger: {
          trigger: sectionRef.value,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.5,
        },
        ease: 'none',
      }
    )

    // Headline clip-path reveal
    if (headlineRef.value) {
      gsap.from(headlineRef.value, {
        scrollTrigger: {
          trigger: sectionRef.value,
          start: 'top 80%',
          toggleActions: 'play none none none',
        },
        clipPath: 'inset(0 100% 0 0)',
        duration: 0.8,
        ease: 'power2.inOut',
      })

      gsap.set(headlineRef.value, { clipPath: 'inset(0 0% 0 0)', delay: 1.2 })
    }

    // Subtext fade up
    if (subtextRef.value) {
      gsap.from(subtextRef.value, {
        scrollTrigger: {
          trigger: sectionRef.value,
          start: 'top 80%',
          toggleActions: 'play none none none',
        },
        y: 30,
        opacity: 0,
        duration: 0.6,
        delay: 0.3,
        ease: 'power3.out',
      })
    }

    // Button scale-in + glow pulse
    if (buttonRef.value) {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.value,
          start: 'top 80%',
          toggleActions: 'play none none none',
        },
        delay: 0.5,
      })

      tl.from(buttonRef.value, {
        scale: 0.9,
        opacity: 0,
        duration: 0.5,
        ease: 'back.out(2)',
      })
      tl.to(buttonRef.value, {
        boxShadow: '0 0 30px rgba(255, 255, 255, 0.3)',
        duration: 0.4,
        ease: 'power1.inOut',
        yoyo: true,
        repeat: 1,
      })
    }
  })
})
</script>

<template>
  <section ref="sectionRef" class="cta-banner py-10 max-md:py-8">
    <div class="mx-auto max-w-7xl px-4 text-center">
      <h2 ref="headlineRef" class="text-xl font-semibold text-white m-0 mb-2">Share your creativity.</h2>
      <p ref="subtextRef" class="text-lg max-md:text-base text-white/80 m-0 mb-6">Publish your template to the ComfyUI community today.</p>
      <a ref="buttonRef" href="/search" class="inline-flex items-center py-3 px-6 bg-white/15 text-white text-sm font-semibold border border-white/30 rounded-md transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring hover:bg-white/25 hover:border-white/50">Submit Template</a>
    </div>
  </section>
</template>

<style scoped>
/* Gradient background with GSAP-animated angle */
.cta-banner {
  background: linear-gradient(var(--gradient-angle, 135deg), rgb(var(--color-comfy-yellow) 0%, rgb(var(--color-comfy-yellow-dark, 180 190 30)) 100%);
}
</style>
