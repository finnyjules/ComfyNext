# Sailor Agent Request Corpus

Realistic natural-language requests a user would type into the in-product agent,
mapped to the single most-appropriate target. Used to harden routing + the surfaces
(2026-06-29). The **curated, deterministic subset that actually runs as tests** lives
in `frontend/tests/unit/agent-capability-routing.unit.spec.ts` (230 cases). This file
is the wider brainstorm + the predicted blind-spots that drove the registry/prompt fixes.

Targets: a capability `nodeType` · `tuneNode` (change a Frame's internals) ·
`graph:*` (node plumbing) · `question` · `ambiguous` · `out-of-scope`.

---

## GenerateImageNode (text-to-image)
make an image of a fox in a forest · generate a picture of a sunset over mountains ·
create an image of a cyberpunk city · draw me a dragon · i need a photo of a red sports car ·
text to image: astronaut riding a horse · imagine a floating island · render a watercolor of a lighthouse ·
dream up a logo concept for a coffee shop · yo make me a sick wallpaper of space · pic of a corgi in a party hat ·
gimme an ai pic of a robot chef · conjure a portrait of a viking · visualize a tropical beach at golden hour ·
produce an image of a vintage diner · make some art, abstract blobs · generate a graphic of a mountain range ·
whip up an illustration of a fox · new image: neon samurai · gen a photo of a bowl of ramen ("gen" = generate)

## FluxLoRARemoteNode (generate with your trained LoRA)
generate an image with my lora · use my trained model to make a portrait · make a picture of my character ·
generate my character at the beach · use my finetune for this · lora gen: my mascot in a city ·
personalized image using my training · run my custom model

## FluxMultiLoRARemoteNode (two LoRAs)
combine my character lora with the watercolor style lora · my character in an anime style lora ·
stack two loras · character plus style, both my models · mix my face lora and the comic style lora

## GenerateAnimeNode
make an anime image of a schoolgirl · anime art of a mecha · draw anime · generate manga style fight scene ·
anime portrait of a knight · waifu pls · make it anime (only NEW; on existing → Edit/Shader)

## GenerateEmojiNode
turn this selfie into an emoji · make an emoji of my face · memoji of me · emojify this photo ·
ios emoji style of this guy · convert my pic to an apple emoji

## ConsistentFaceNode
same character again but on a boat · keep the same face, new pose · this person in a new scene ·
consistent character across shots · reuse this face in a forest · same person different outfit · keep her identity consistent

## SketchToImageNode
turn my sketch into a finished image · finish my drawing · make my doodle real · colorize my line art ·
scribble to image · render this rough sketch as a photo

## TextEffectNode (typographic art image — single word/title, STATIC)
make a chrome text effect for "BOSS" · holographic letters spelling LOVE · liquid metal text "SALE" ·
3d text treatment for my logo word · neon text effect · fancy word art for "MIAMI" · give me a title treatment, brutalist

## EditImageNode (NL image editing)
change her shirt to red · make her hair blue · make it nighttime · change the sky to a sunset ·
add a hat to this guy · put glasses on him · remove the trash can from the photo · photoshop out the ex ·
add a small logo to the corner of this photo · make the car a convertible · swap the background to a beach (content, not solid colour) ·
tweak this pic, make the grass greener · erase the power lines · give the dog a bowtie

## RestyleFromImageNode (style transfer w/ reference image)
make this look like that painting · apply the style of this reference · style transfer using this image ·
match this aesthetic onto my photo · paint my photo in the style of this one · give it the vibe of this reference image

## RestyleWithLoRANode
restyle this photo with my lora · convert this using my trained style model · apply my finetune style to this image

## BlendSceneNode
blend these together so it looks like one photo · harmonize this composite · match the lighting on the pasted object ·
add realistic contact shadows · make the cutout actually fit the scene · integrate this cutout into the background

## ProductShotNode
make a studio product shot of this bottle · put my product in a nice scene · ecommerce photo of this sneaker ·
professional product photography · stage my product on marble · marketing shot of this perfume · commercial advertising image of this can

## RotateCameraNode
rotate the camera around this · show me the side view · turn it around, show the back · different angle of this object ·
low angle shot of this · view from above · spin the view 90 degrees

## OutpaintImageNode
expand this image · outpaint the edges · extend the canvas to the left · zoom out and fill in more scene ·
uncrop this photo · make it wider, add more background · turn this into a landscape orientation, invent the sides · add more space around the subject

## UpscaleImageNode
upscale this · make it higher resolution · 4k upscale · upres this image · super resolution please ·
enlarge to print size · make this hd · increase the resolution · scale up the photo to 4096

## EnhanceDetailNode
enhance the detail · make it sharper · sharpen this image · deblur this photo · fix this blurry shot ·
add fine detail · make it crisper · add realism, more texture · refine this image, more detail · polish the image quality

## RestorePhotoNode
restore this old photo · fix my grandma's photograph · repair this damaged picture · colorize this black and white photo ·
remove the scratches and creases · fix the fading on this vintage scan · bring this old photo back to life

## FixFacesNode
fix the faces · restore the face · deblur the face · fix these messed up ai faces · clean up the eyes ·
repair the distorted face · sharpen just the face

## RemoveBackgroundNode
remove the background · cut out the subject · make it transparent · rm bg · knock out the background ·
transparent png of this · isolate the person · yo cut this dude out · get rid of the background · no background please ·
backround removal (typo) · make this one transparent · delete the white backdrop · extract just the product · put it on a transparent backdrop

## SplitPhotoLayersNode
split this into subject and background layers · separate the foreground and background · give me a clean plate behind the subject ·
remove the subject and fill the hole · decompose this photo into layers · pull the subject out and keep the background separate

## LayerizeGraphicNode
layerize this poster · split this design into editable layers · extract the text layers from this graphic ·
make this flyer editable · separate the text from the background of this ad · deconstruct this layout into layers

## DescribeImageNode (visual Q&A about pixels)
describe this image · what's in this picture · caption this · what do you see here · tell me about this photo ·
count the people in this image · how many cars are in this · analyze this image · what color is her dress

## ExtractTextNode (OCR)
extract the text from this · ocr this screenshot · read the text in this image · what does the sign say ·
transcribe this document photo · pull the text off this receipt · digitize this scanned page

## FindObjectsNode
find all the cars in this image · detect the people · where is the dog in this photo · bounding boxes for the products ·
object detection on this · locate every face

## GenerateVideoNode
generate a video of waves crashing · make a video from this photo · animate this image · turn this picture into a clip ·
image to video · text to video: a city timelapse · make it move · bring this photo to life · create a 5 second clip of a campfire · ai video of a flying drone shot

## FilmShotNode
film a cinematic shot of this · dolly zoom on this image · slow push in on the subject · tracking shot across this scene ·
crane shot of this · give me a movie-style camera move · establishing shot from this photo

## LipsyncNode
lip sync this video to the audio · make the face talk to this track · dub this clip · sync the lips to the speech ·
talking head from this · animate the mouth to match audio

## EnhanceVideoNode
enhance this video · upscale the video to 4k · denoise this clip · sharpen the video · improve the video quality · restore this old footage

## DescribeVideoNode
describe this video · what happens in this clip · summarize the video · caption this footage · what's going on in this video

## GenerateMusicNode
generate some lo-fi music · make a background track · compose an upbeat jingle · text to music: epic orchestral ·
create a chill instrumental · make a song about summer · soundtrack for my intro

## GenerateSpeechNode
read this text aloud · text to speech · make a voiceover for this script · narrate this paragraph · say this in a calm voice ·
tts this · voice over for my video · make it talk

## TranscribeAudioNode
transcribe this audio · speech to text · get the transcript of this recording · subtitle this audio ·
what is said in this clip · transcribe my podcast episode

## IdentifySpeakersNode
who said what in this audio · identify the speakers · diarize this interview · label who's talking · transcribe this meeting by speaker

## CloneSingingVoiceNode
re-sing this song in another voice · ai cover of this track · change the singer on this · rvc this vocal · swap the vocals to a different voice

## Generate3DNode
make a 3d model of this · image to 3d · turn this into a 3d mesh · generate a glb from this photo · make it 3d · 3d asset from this image

## Hunyuan3DMultiViewNode
build a 3d model from these front and back views · character sheet to 3d · multi-view 3d from my turnaround · reconstruct a mesh from these 4 views

## ImprovePromptNode
improve my prompt · make this prompt better · expand this into a detailed prompt · flesh out my prompt ·
turn my idea into a good image prompt · optimize this prompt

## ChatLLMNode
ask the ai to write a tagline · write me a paragraph about dogs · chat with an llm · ask claude something ·
get a written answer to this question · write a product description for this

## SummarizeTextNode
summarize this text · tldr this · give me the key points · condense this article · boil this down to bullets · recap this transcript

## TranslateTextNode
translate this to spanish · what does this say in english · convert this text to french · localize this into japanese · say this in german

## RewriteToneNode
make this more formal · rewrite this to be casual · make this copy punchier · change the tone to friendly · rephrase this professionally · polish this writing

## BrainstormIdeasNode
brainstorm names for my brand · give me 10 ideas for a logo · list some concepts for a poster · come up with taglines ·
suggest different angles for this campaign · ideate some color schemes

## GradientStudio (procedural gradient)
make a gradient · add a blue to purple gradient background · mesh gradient backdrop · liquid marble gradient ·
radial gradient, orange center · animated rainbow gradient · soft color wash background · ombre background pink to white ·
aurora color field · gradiant background (typo) · smooth blend of teal and navy · abstract colorful gradient backdrop

## ShaderStudio (image effects)
apply a halftone effect to this · add a glitch effect · pixelate this image · duotone this · chromatic aberration on this ·
kaleidoscope effect · oil painting filter · crt scanlines · ascii art effect · add a vignette and bloom · liquify distortion ·
crosshatch this image · posterize it · holographic foil effect

## TextureStudio
make a seamless tileable pattern · repeating geometric pattern · herringbone tile pattern · polka dot wallpaper ·
checkerboard texture · truchet tiles · fabric texture, seamless · hex tile pattern · stripes pattern that tiles

## SpaceType (kinetic typography)
animate the word HELLO · make a 3d spinning text intro · kinetic typography for my title · text on a sphere ·
melting text animation · text tunnel effect · elastic stretchy text · ribbon text animation · glitchy animated title ·
spiral text · extruded 3d text that rotates

## Compositor (new Frame / composite)
put this image in a frame · create a new artboard · combine these images into one composition · overlay these two images ·
stack these as layers · make a composite with the logo on top · arrange these elements on a canvas · add a caption over this image ·
design a poster composite with this photo · new frame with this picture and a title · merge these into one image with text

## SmartLayout
make a poster layout · design an ad layout · lay this out nicely · social media post layout for this ·
adapt this design to story and square · resize this design to other formats · swiss style poster ·
create a flyer with headline and body · make a banner ad · multi-format layout for my campaign · arrange this headline and image into a grid layout

---

## tuneNode (change INTERNALS of an existing Frame/Compositor)
*Assume a Frame is selected/open — these edit a layer or the frame, not the graph.*
make the background blue · change the background to dark gray · make the title bigger · make the headline huge ·
change the text to "SUMMER SALE" · make the heading red · center the text · move the logo to the top right ·
put the title at the bottom left · nudge the image up a bit · make the subtitle smaller · bold the headline ·
change the font to something condensed · give the title a sunset gradient fill · add a white outline to the text ·
make this layer 50% transparent · bring the logo to the front · send the headline behind the image ·
add a centered white headline that says NEW · add a red rectangle behind the text · make the box fill teal ·
shift the photo left · rotate the logo slightly · change the background to a blue gradient · delete the subtitle layer ·
swap the headline color to white · make the background a sunset gradient · tint the photo warm · increase the title font weight ·
left-align all the text · make the caption pop more · add the slogan under the title · put a thin line between the title and body

## graph:setWidget
set the seed to 42 · use 30 steps · change the sampler to euler · set cfg to 7.5 · switch the model to flux dev ·
set the aspect ratio to 16:9 · bump the steps to 50 · set the upscale factor to 4 · change the denoise to 0.6 ·
set the strength to 0.8 · pick the 9:16 aspect · set the prompt on this node to "a cat"

## graph:connect
connect this to the upscaler · wire the image output into the frame · link the generator to the remove background node ·
plug this into that · hook the output up to the video node · feed this node's image into the compositor · connect them

## graph:deleteNode
delete this node · remove that upscaler · get rid of this node · delete the selected node · trash this node

## graph:setMode
mute this node · bypass the upscaler · disable this node · turn this node off · bypass it so it passes through · re-enable this node · unmute that one

## question (about the graph, not an edit)
what does this node do · what's connected to the frame · how many nodes are on the canvas · what's the seed set to right now ·
which model is this using · is this node connected to anything · what's the current aspect ratio · explain this graph ·
why isn't this node running · what feeds into the video node

## ambiguous (genuinely underspecified → clarify)
make it better · fix this · do the thing · can you help with this · improve it · make it nice · edit this · change it ·
make it pop · do that · redo this · something's off · make it look good · update this · handle it · make it cooler · change the style · bigger

## out-of-scope
export this to PDF · email this to my client · buy more credits · download as SVG · save this to my desktop · print this poster ·
post this to instagram · schedule this to publish tomorrow · undo my last 5 actions · share a link to this project · delete my account ·
what's my credit balance · invoice me · add my teammate to this project · set up a subscription · create a folder for my assets ·
duplicate this whole project · roll back to yesterday's version

---

# Predicted blind spots / mis-routes (drove the fixes)

These are phrasings the corpus flagged as likely-wrong. Format: phrase — why — correct target. Several are now fixed in the registry; the context-dependent ones are the LLM's job (the router only needs to keep the right capability discoverable).

1. "make the background blue" — listed under Compositor AND is tuneNode — **tuneNode** when a Frame exists (was adding a node). *fixed: Compositor owns solid-bg intents; the LLM picks tuneNode from context.*
2. "blue gradient background" — "background"(Compositor) + "gradient"(GradientStudio) — **GradientStudio** for a new bg, **setBackground gradient** inside a frame.
3. "add text" / "add a title" — bare, with a frame open → **tuneNode (addLayer)**; no bare-"add text" intent.
4. "make it bigger" — Upscale intent (resolution) but in a Frame = resize a layer — genuinely **ambiguous**.
5. "make it pop" / "looks boring" / "needs more energy" — no coverage, emotional → **ambiguous**.
6. "sharpen" vs "sharpen the face" — face-qualified must beat generic. *fixed: collision test.*
7. "upscale this video" — must beat image upscaler → **EnhanceVideoNode**. *fixed: collision test.*
8. "make it hd" / "4k" (no media noun) — image vs video → **ambiguous**.
9. "make this transparent" (in a frame) = opacity → **tuneNode**, not RemoveBackground.
10. "add a logo" — Edit vs Compositor vs tuneNode.
11. "change the background" — Edit (re-render) vs setBackground (frame colour).
12. "make it warmer / cooler / brighter" — relative photo edits, uncovered → **EditImageNode** (or tuneNode tint).
13. "colorize" — Restore vs SketchToImage vs bare-ambiguous.
14. "animate" alone — GenerateVideo vs SpaceType. *fixed: image→video, word→SpaceType collision tests.*
15. "3d text effect" — SpaceType vs TextEffectNode (static vs animated) — duplicate phrase across two caps.
16. "holographic" — TextEffect (letters) vs Shader (foil).
17. "describe this" — DescribeImage (image) vs a graph **question** (deictic "this" trap).
18. "summarize this" — SummarizeText vs DescribeVideo. *fixed: noun disambiguation tests.*
19. "read this" — Speech (aloud) vs OCR (the text) — bare = ambiguous. *fixed: "...aloud" vs "the text in this image".*
20. "remove the person/car" — sounds like RemoveBackground but is object removal → **EditImageNode**. *fixed: EditImage object-removal intents + collision tests.*
21. "cut this out and put it on a blue background" — compound: RemoveBackground + Compositor.
22. "put it behind" / "stick it behind" — z-order → **tuneNode setLayerDepth back**. *fixed: setLayerDepth command.*
23. "center it" / "top right" — positional → **tuneNode setLayerProps**. *fixed: positional-preset hints.*
24. "move it up a bit" — relative positional → **tuneNode**. *fixed: relative-delta prompt rule.*
25. "vaporwave vibe" / "retro 80s look" — aesthetic outcome → ambiguous / Shader.
26. "i need a youtube thumbnail" — outcome-framed → **SmartLayout / Compositor**.
27. "make a meme" — image + top/bottom text → **Compositor**.
28. "deblur" — Enhance vs FixFaces (face-qualified). *fixed.*
29. "enhance this" (no noun) — image vs video → **ambiguous**.
30. "layer this" — SplitPhotoLayers vs LayerizeGraphic vs Compositor (triple collision).
31. "make it move" — GenerateVideo vs SpaceType (text title).
32. "add shadows" — BlendScene vs a drop-shadow Edit.
33. "make it square / 1080x1080" — SmartLayout vs Outpaint ("make it landscape/wider").
34. "crop this" — no crop capability; dangerous antonym match to Outpaint ("uncrop").
35. "brighten / increase contrast / fix exposure" — adjustment edits, uncovered → **EditImage / tuneNode**.
36. "turn this into a sticker" — RemoveBackground + outline, mis-routes to GenerateEmoji.
37. "make a gif" — no coverage; closest GenerateVideo.
38. "write a caption for this" — DescribeImage ("caption") vs ChatLLM (marketing copy).
39. "dub this" — Lipsync vs Translate+Speech.
40. "clean up this" — FixFaces vs EnhanceVideo vs EnhanceDetail — noun decides.

## Recurring failure patterns
- **Deictic "this/it" + bare verb** ("describe this", "make it bigger", "remove the X") — disambiguation hinges on the selected node, the media type, and whether a Frame is open. That's the LLM+snapshot's job, not the keyword router's.
- **Frame-vs-node** is the sharpest line: "make the background blue", "add text", "center it", "put it behind", "make this transparent", "make the title bigger" → **tuneNode** when a Frame is active.
- **gradient vs solid**, **gradient-as-bg vs GradientStudio-node** — recurring trap pair.
- **Antonym/near-miss matches** (crop→uncrop, "remove the person"→RemoveBackground) are the most dangerous because they confidently mis-route.
- Whole categories had **zero intent coverage**: relative photo adjustments, positional commands, crop, meme/thumbnail/sticker/gif outcomes, pure-emotional prompts.
