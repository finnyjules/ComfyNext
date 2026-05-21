import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Flip } from 'gsap/Flip'

gsap.registerPlugin(ScrollTrigger, Flip)

gsap.defaults({
  ease: 'power2.out',
  duration: 0.6,
})

export { gsap, ScrollTrigger, Flip }
