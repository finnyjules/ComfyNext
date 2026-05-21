<script setup>
defineProps({
  parameters: { type: Array, default: () => [] },
})
</script>

<template>
  <section v-if="parameters.length" class="workflow-params">
    <h2 class="workflow-params__heading">Parameters</h2>
    <div class="workflow-params__table-wrap">
      <table class="workflow-params__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Default</th>
            <th>Range</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="param in parameters" :key="param.name">
            <td class="workflow-params__name">{{ param.name }}</td>
            <td>{{ param.default }}</td>
            <td>{{ param.min !== undefined ? `${param.min}–${param.max}` : '—' }}</td>
            <td>{{ param.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.workflow-params {
  &__heading {
    font-size: $text-xl;
    font-weight: $weight-bold;
    color: $color-text-primary;
    margin-bottom: $space-4;
  }

  &__table-wrap {
    overflow-x: auto;
    border-radius: $radius-lg;
    border: 1px solid $color-border;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;
    font-size: $text-sm;

    th, td {
      padding: $space-3 $space-4;
      text-align: left;
      border-bottom: 1px solid $color-border;
    }

    th {
      background: $color-bg-tertiary;
      color: $color-text-tertiary;
      font-weight: $weight-medium;
      font-size: $text-xs;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    td {
      color: $color-text-secondary;
    }
  }

  &__name {
    font-weight: $weight-medium;
    color: $color-text-primary;
    font-family: $font-mono;
    font-size: $text-xs;
  }
}
</style>
