/**
 * GSAP setup for the kinetic typography system. Registers the plugins
 * we need (SplitText, ScrambleTextPlugin, TextPlugin) and re-exports
 * gsap with them ready. Separate from the community/gsap.js setup so
 * the canvas nodes don't pull in ScrollTrigger/Flip.
 */
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { TextPlugin } from 'gsap/TextPlugin'

gsap.registerPlugin(SplitText, ScrambleTextPlugin, TextPlugin)

export { gsap, SplitText, ScrambleTextPlugin }
