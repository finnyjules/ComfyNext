import { onMounted } from 'vue'
import { useGsap } from './useGsap.js'

export function useScrollAnimation() {
  const { gsap, ScrollTrigger, animate, prefersReducedMotion } = useGsap()

  function revealOnScroll(element, options = {}) {
    if (prefersReducedMotion || !element) return

    animate(() => {
      gsap.from(element, {
        scrollTrigger: {
          trigger: element,
          start: 'top 85%',
          toggleActions: 'play none none none',
          ...options.scrollTrigger,
        },
        y: options.y ?? 40,
        opacity: 0,
        duration: options.duration ?? 0.7,
        stagger: options.stagger ?? 0,
        delay: options.delay ?? 0,
      })
    })
  }

  function staggerChildren(parent, childSelector, options = {}) {
    if (prefersReducedMotion || !parent) return

    animate(() => {
      gsap.from(parent.querySelectorAll(childSelector), {
        scrollTrigger: {
          trigger: parent,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
        y: options.y ?? 30,
        opacity: 0,
        duration: options.duration ?? 0.5,
        stagger: options.stagger ?? 0.08,
      })
    })
  }

  function flipInChildren(parent, childSelector, options = {}) {
    if (prefersReducedMotion || !parent) return

    animate(() => {
      const children = parent.querySelectorAll(childSelector)
      if (!children.length) return

      gsap.set(parent, { perspective: options.perspective ?? 1000 })

      const { perspective, start, stagger, duration, ease, ...extraProps } = options

      gsap.from(children, {
        scrollTrigger: {
          trigger: parent,
          start: start ?? 'top 85%',
          toggleActions: 'play none none none',
        },
        rotateX: 15,
        y: 60,
        opacity: 0,
        scale: 0.95,
        duration: duration ?? 0.7,
        stagger: stagger ?? 0.06,
        ease: ease ?? 'power3.out',
        transformOrigin: 'center bottom',
        ...extraProps,
      })
    })
  }

  function revealWords(element, options = {}) {
    if (prefersReducedMotion || !element) return

    animate(() => {
      const text = element.textContent
      const words = text.trim().split(/\s+/)
      element.innerHTML = words
        .map((word) => `<span class="gsap-word" style="display:inline-block">${word}&nbsp;</span>`)
        .join('')

      gsap.from(element.querySelectorAll('.gsap-word'), {
        scrollTrigger: {
          trigger: element,
          start: options.start ?? 'top 85%',
          toggleActions: 'play none none none',
        },
        y: options.y ?? 40,
        opacity: 0,
        duration: options.duration ?? 0.6,
        stagger: options.stagger ?? 0.08,
        ease: options.ease ?? 'power3.out',
      })
    })
  }

  function parallax(element, options = {}) {
    if (prefersReducedMotion || !element) return

    animate(() => {
      gsap.to(element, {
        scrollTrigger: {
          trigger: options.trigger ?? element,
          start: options.start ?? 'top bottom',
          end: options.end ?? 'bottom top',
          scrub: options.scrub ?? true,
        },
        y: options.y ?? 50,
        ease: 'none',
      })
    })
  }

  function alternateSlideIn(parent, childSelector, options = {}) {
    if (prefersReducedMotion || !parent) return

    animate(() => {
      const children = parent.querySelectorAll(childSelector)
      children.forEach((child, i) => {
        const fromLeft = i % 2 === 0
        gsap.from(child, {
          scrollTrigger: {
            trigger: parent,
            start: options.start ?? 'top 85%',
            toggleActions: 'play none none none',
          },
          x: fromLeft ? -(options.distance ?? 60) : (options.distance ?? 60),
          rotateZ: fromLeft ? -(options.rotation ?? 3) : (options.rotation ?? 3),
          opacity: 0,
          duration: options.duration ?? 0.7,
          delay: i * (options.stagger ?? 0.1),
          ease: options.ease ?? 'power3.out',
        })
      })
    })
  }

  function scaleBounce(element, options = {}) {
    if (prefersReducedMotion || !element) return

    animate(() => {
      gsap.from(element, {
        scrollTrigger: {
          trigger: options.trigger ?? element,
          start: options.start ?? 'top 85%',
          toggleActions: 'play none none none',
        },
        scale: options.fromScale ?? 0,
        duration: options.duration ?? 0.6,
        delay: options.delay ?? 0,
        ease: options.ease ?? 'back.out(2)',
      })
    })
  }

  return { revealOnScroll, staggerChildren, flipInChildren, revealWords, parallax, alternateSlideIn, scaleBounce }
}
