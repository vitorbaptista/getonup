<template>
  <div class="wrap">
    <div class="card">
      <div class="avatar">{{ initials }}</div>
      <h1>{{ name }}</h1>
      <p class="role">{{ role }}</p>
      <button @click="likes++">♥ {{ likes }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
const name = "Ada Lovelace";
const role = "getonupd with vue 3";
const likes = ref(0);
const initials = computed(() =>
  name.split(" ").map((w) => w[0]).join("")
);
</script>

<style>
.wrap { min-height: 100vh; display: grid; place-items: center; background: #0b0d10; }
.card {
  text-align: center; padding: 40px; border-radius: 20px; color: #e7e9ee;
  background: #14171c; border: 1px solid #232830; width: 280px;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.avatar {
  width: 72px; height: 72px; margin: 0 auto 16px; border-radius: 50%;
  display: grid; place-items: center; font-size: 24px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #7c5cff, #22d3ee);
}
h1 { margin: 0 0 4px; font-size: 1.3rem; }
.role { color: #9aa0ab; margin: 0 0 20px; font-size: 0.85rem; }
button {
  border: 1px solid #232830; background: #1a1e24; color: #e7e9ee; padding: 10px 20px;
  border-radius: 10px; cursor: pointer; font-size: 1rem; transition: transform 0.1s;
}
button:active { transform: scale(0.95); }
</style>
