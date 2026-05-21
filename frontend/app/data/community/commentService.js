import { comments } from './mock/index.js'

export function getComments(workflowId, { type = 'all', sort = 'newest' } = {}) {
  let results = comments.filter((c) => c.workflowId === workflowId)

  if (type !== 'all') {
    results = results.filter((c) => c.type === type)
  }

  // Build threaded structure
  const topLevel = results.filter((c) => !c.parentId)
  const replies = results.filter((c) => c.parentId)

  const threaded = topLevel.map((comment) => ({
    ...comment,
    replies: replies.filter((r) => r.parentId === comment.id),
  }))

  // Sort
  switch (sort) {
    case 'newest':
      threaded.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      break
    case 'helpful':
      threaded.sort((a, b) => b.upvotes - a.upvotes)
      break
    case 'creator':
      threaded.sort((a, b) => {
        if (a.isCreatorReply && !b.isCreatorReply) return -1
        if (!a.isCreatorReply && b.isCreatorReply) return 1
        return new Date(b.createdAt) - new Date(a.createdAt)
      })
      break
  }

  return threaded
}

export function getCommentCount(workflowId) {
  return comments.filter((c) => c.workflowId === workflowId).length
}

export function getQuestionCount(workflowId) {
  return comments.filter((c) => c.workflowId === workflowId && c.type === 'question').length
}

export function getShowcaseCount(workflowId) {
  return comments.filter((c) => c.workflowId === workflowId && c.type === 'showcase').length
}
