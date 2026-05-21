import { ref, computed } from 'vue'

export interface CommunityRoute {
  view: 'home' | 'workflow' | 'creator' | 'collection'
  slug?: string       // workflow slug
  handle?: string     // creator handle
  collectionId?: string
  label?: string
}

const history = ref<CommunityRoute[]>([{ view: 'home' }])

export function useCommunityNav() {
  const currentRoute = computed(() => history.value[history.value.length - 1])

  function navigateTo(route: Omit<CommunityRoute, 'view'> & { view: CommunityRoute['view'] }) {
    history.value.push(route)
  }

  function goBack() {
    if (history.value.length > 1) {
      history.value.pop()
    }
  }

  function goHome() {
    history.value = [{ view: 'home' }]
  }

  return { currentRoute, navigateTo, goBack, goHome }
}
