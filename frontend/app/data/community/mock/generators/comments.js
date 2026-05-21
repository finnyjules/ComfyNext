import { faker } from '@faker-js/faker'

// Question-type comment templates
const questionTemplates = [
  'What checkpoint are you using for this? I tried {checkpoint} but got different results.',
  'Has anyone gotten this to work with {model}? I keep getting OOM errors on my {vram}GB card.',
  'How do I adjust the ControlNet strength without breaking the composition?',
  'Is there a way to make this work with lower VRAM? Running on a {vram}GB GPU.',
  'What negative prompt are you using? The default one gives me weird artifacts.',
  'Can this be combined with {technique} for better results?',
  'Getting an error on node {nodeNum}: "Input type mismatch". Any ideas?',
  'What sampler works best for this workflow? I\'ve been using euler_ancestral.',
  'Does this support batch processing? I need to generate {batchSize} images.',
  'How long does this take on a {gpu}? Getting about {time} seconds per image.',
  'The VAE decode step is producing blurry outputs. Any fix for this?',
  'Can I use this with {model} instead of the recommended model?',
  'What LoRA weights do you recommend for portrait shots?',
  'Is there a version of this that works without ControlNet?',
  'How do I get the face detailer to work? It keeps crashing ComfyUI.',
  'What resolution should I use for best results with {model}?',
  'The upscaling step seems to add noise. Am I doing something wrong?',
  'Can someone explain what the CFG scale does in this context?',
  'Is there a way to keep consistency across batch outputs?',
  'Why does the output look different every time even with the same seed?',
  'What custom nodes do I need to install for this to work?',
  'Getting "module not found" error for Impact Pack. Which version do I need?',
  'Has anyone tested this on ComfyUI latest? Some nodes seem deprecated.',
  'What\'s the recommended steps count for quality vs speed tradeoff?',
  'Can I use this for commercial projects? What\'s the license situation?',
]

// Showcase-type comment templates
const showcaseTemplates = [
  'Just tried this and the results are incredible! Here\'s what I got with a simple prompt.',
  'Been using this workflow for {days} days now, absolutely love it. {compliment}',
  'This is by far the best {category} workflow I\'ve found. The quality is outstanding.',
  'Modified this slightly to add {technique} and got amazing results!',
  'Used this for a client project and they were blown away. Thanks for sharing!',
  'Ran this on my {gpu} and got beautiful results in just {time} seconds.',
  'Combined this with {technique} and the output quality jumped significantly.',
  'This workflow saved me hours of work. The batch processing feature is a game changer.',
  'The face detail quality from this workflow is unreal. Best I\'ve seen so far.',
  'Finally a workflow that produces consistent results. No more random artifacts!',
  'Just generated 50 images with this. Every single one was production quality.',
  'The ControlNet integration in this is so smooth. Great work!',
  'Loving the results with {model}. Much better than my previous setup.',
  'This replaced my entire previous pipeline. Simpler and better quality.',
  'The IPAdapter reference feature works perfectly for maintaining style consistency.',
  'Tested this against 5 other workflows. This one wins by a mile.',
  'Generated some amazing concept art with this. My art director was impressed.',
  'The upscaling quality from this workflow is insane. 4x with zero artifacts.',
  'Using this daily for my {useCase} work. Highly recommended!',
  'This is the workflow I wish I had when I started with ComfyUI.',
  'Perfect for {useCase}. Simple to use and consistently great output.',
  'The attention to detail in this workflow shows. Everything is well thought out.',
  'Just did a comparison test — this produces noticeably better skin textures.',
  'Modified the prompt template and got studio-quality product shots.',
  'Running this on a {gpu} with {vram}GB VRAM, no issues at all.',
]

// Reply templates (for both question replies and showcase reactions)
const questionReplyTemplates = [
  'Try setting the CFG to {cfgValue} and using {sampler} sampler. That fixed it for me.',
  'You need to install {customNode} for that node to work properly.',
  'Make sure you\'re on ComfyUI v{version} or later. They fixed that bug.',
  'The issue is with your VAE. Try the included one instead of the external.',
  'Lower your resolution to {resolution} first, then upscale. Saves a ton of VRAM.',
  'I had the same issue. Fixed it by updating {customNode} to the latest version.',
  'Yes, it works with {model} but you need to adjust the CFG to around {cfgValue}.',
  'That error usually means you\'re missing a custom node. Check the dependencies list.',
  'Use fp16 precision to save VRAM. You can do this in the checkpoint loader settings.',
  'The recommended steps count is {steps} for this model. Going higher doesn\'t help much.',
  'Make sure your ControlNet model matches the base model version.',
  'Try clearing the cache and restarting ComfyUI. That fixed it for me.',
]

const showcaseReplyTemplates = [
  'Those results look amazing! What prompt did you use?',
  'Love what you did with {technique}. Going to try that modification.',
  'The quality difference is noticeable. Great find!',
  'Would you mind sharing your modified workflow?',
  'Wow, that\'s impressive for a {gpu}. Might need to upgrade.',
  'How many steps did you use for those results?',
  'The skin detail is incredible. What LoRA are you using?',
]

const creatorReplyTemplates = [
  'Thanks for the feedback! I\'ll add {feature} in the next version.',
  'Glad you\'re enjoying it! For that issue, try updating to v{version}.',
  'Great suggestion! I\'ve added that to the roadmap.',
  'That\'s a known issue with {model}. Working on a fix for the next release.',
  'Thanks for the report! The fix will be in v{version} dropping next week.',
  'Awesome results! Feel free to share those in the showcase channel.',
  'For commercial use, yes — this is MIT licensed. Go ahead!',
  'Good catch. I\'ll update the description with those requirements.',
  'I appreciate you testing on different hardware! Adding your findings to the docs.',
]

const gpus = ['RTX 4090', 'RTX 4080', 'RTX 4070 Ti', 'RTX 3090', 'RTX 3080', 'RTX 3070', 'RTX 4060', 'A100']
const vrams = [8, 10, 12, 16, 24, 48]
const models = ['FLUX.1 Dev', 'FLUX.1 Schnell', 'SDXL', 'SD 1.5', 'Stable Cascade', 'Hunyuan']
const techList = ['ControlNet', 'IPAdapter', 'LoRA', 'AnimateDiff', 'Face Swap', 'Regional Prompting']
const customNodeNames = [
  'ComfyUI-Impact-Pack', 'ComfyUI-Manager', 'ComfyUI-Inspire-Pack',
  'ComfyUI-Advanced-ControlNet', 'ComfyUI-IPAdapter-Plus', 'ComfyUI-KJNodes',
]
const samplers = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde', 'uni_pc', 'dpmpp_2m_sde']
const useCases = ['product photography', 'concept art', 'character design', 'portrait retouching', 'social media content', 'game assets', 'architectural visualization']
const categoryNames = ['portrait', 'landscape', 'product', 'character', 'architecture', 'concept art']
const compliments = [
  'The prompt adherence is excellent.',
  'Best workflow in this category.',
  'Clean node setup too.',
  'Easy to customize as well.',
  'Great documentation included.',
]

function fillTemplate(template) {
  return template
    .replace('{checkpoint}', faker.helpers.arrayElement(models))
    .replace('{model}', faker.helpers.arrayElement(models))
    .replace('{technique}', faker.helpers.arrayElement(techList))
    .replace('{gpu}', faker.helpers.arrayElement(gpus))
    .replace('{vram}', String(faker.helpers.arrayElement(vrams)))
    .replace('{time}', String(faker.number.int({ min: 8, max: 120 })))
    .replace('{days}', String(faker.number.int({ min: 3, max: 60 })))
    .replace('{batchSize}', String(faker.number.int({ min: 10, max: 100 })))
    .replace('{nodeNum}', String(faker.number.int({ min: 1, max: 15 })))
    .replace('{cfgValue}', String(faker.number.float({ min: 2, max: 15, multipleOf: 0.5 })))
    .replace('{sampler}', faker.helpers.arrayElement(samplers))
    .replace('{customNode}', faker.helpers.arrayElement(customNodeNames))
    .replace('{version}', `${faker.number.int({ min: 1, max: 5 })}.${faker.number.int({ min: 0, max: 9 })}`)
    .replace('{resolution}', faker.helpers.arrayElement(['512x512', '768x768', '1024x1024']))
    .replace('{steps}', String(faker.number.int({ min: 15, max: 40 })))
    .replace('{feature}', faker.helpers.arrayElement(['batch mode', 'ControlNet support', 'FLUX compatibility', 'lower VRAM option', 'preset system']))
    .replace('{category}', faker.helpers.arrayElement(categoryNames))
    .replace('{compliment}', faker.helpers.arrayElement(compliments))
    .replace('{useCase}', faker.helpers.arrayElement(useCases))
}

function generateCommentContent(type) {
  const templates = type === 'question' ? questionTemplates : showcaseTemplates
  return fillTemplate(faker.helpers.arrayElement(templates))
}

function generateReplyContent(parentType, isCreatorReply) {
  if (isCreatorReply) {
    return fillTemplate(faker.helpers.arrayElement(creatorReplyTemplates))
  }
  const templates = parentType === 'question' ? questionReplyTemplates : showcaseReplyTemplates
  return fillTemplate(faker.helpers.arrayElement(templates))
}

export function generateComments(count = 500, workflowIds) {
  faker.seed(42)

  // Default workflow IDs if not provided
  if (!workflowIds || workflowIds.length === 0) {
    workflowIds = Array.from({ length: 200 }, (_, i) => `wf_${String(i + 1).padStart(4, '0')}`)
  }

  const comments = []

  // First pass: generate top-level comments (~70%)
  const topLevelCount = Math.floor(count * 0.7)
  const replyCount = count - topLevelCount

  for (let i = 0; i < topLevelCount; i++) {
    const id = `cmt_${String(i + 1).padStart(4, '0')}`
    const workflowId = faker.helpers.arrayElement(workflowIds)

    // 40% questions, 60% showcase
    const type = faker.datatype.boolean(0.4) ? 'question' : 'showcase'

    // Author (random creator or community member)
    const isCreator = faker.datatype.boolean(0.15)
    const authorIndex = isCreator
      ? faker.number.int({ min: 1, max: 50 })
      : faker.number.int({ min: 51, max: 500 })
    const authorId = isCreator
      ? `cr_${String(authorIndex).padStart(3, '0')}`
      : `user_${String(authorIndex).padStart(4, '0')}`

    const createdAt = faker.date.between({
      from: '2025-06-01T00:00:00Z',
      to: '2026-01-14T00:00:00Z',
    })

    comments.push({
      id,
      workflowId,
      author: {
        id: authorId,
        handle: isCreator ? `@creator_${authorIndex}` : `@user_${authorIndex}`,
        displayName: isCreator ? `Creator ${authorIndex}` : faker.person.fullName(),
        avatarUrl: `https://i.pravatar.cc/150?u=${authorId}`,
      },
      content: generateCommentContent(type),
      type,
      parentId: null,
      upvotes: faker.number.int({ min: 0, max: type === 'question' ? 25 : 80 }),
      isCreatorReply: false,
      createdAt: createdAt.toISOString(),
    })
  }

  // Second pass: generate replies (~30%)
  for (let i = 0; i < replyCount; i++) {
    const id = `cmt_${String(topLevelCount + i + 1).padStart(4, '0')}`

    // Pick a random top-level comment to reply to
    const parentComment = faker.helpers.arrayElement(
      comments.filter((c) => c.parentId === null)
    )

    // ~20% of replies are from the workflow creator
    const isCreatorReply = faker.datatype.boolean(0.2)

    const authorIndex = isCreatorReply
      ? faker.number.int({ min: 1, max: 50 })
      : faker.number.int({ min: 51, max: 500 })
    const authorId = isCreatorReply
      ? `cr_${String(authorIndex).padStart(3, '0')}`
      : `user_${String(authorIndex).padStart(4, '0')}`

    const parentDate = new Date(parentComment.createdAt)
    const createdAt = faker.date.between({
      from: parentDate,
      to: new Date(parentDate.getTime() + 14 * 24 * 60 * 60 * 1000), // within 14 days of parent
    })

    comments.push({
      id,
      workflowId: parentComment.workflowId,
      author: {
        id: authorId,
        handle: isCreatorReply ? `@creator_${authorIndex}` : `@user_${authorIndex}`,
        displayName: isCreatorReply ? `Creator ${authorIndex}` : faker.person.fullName(),
        avatarUrl: `https://i.pravatar.cc/150?u=${authorId}`,
      },
      content: generateReplyContent(parentComment.type, isCreatorReply),
      type: parentComment.type,
      parentId: parentComment.id,
      upvotes: faker.number.int({ min: 0, max: isCreatorReply ? 40 : 20 }),
      isCreatorReply,
      createdAt: createdAt.toISOString(),
    })
  }

  // Sort all comments by creation date
  comments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  return comments
}
