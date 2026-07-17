<script setup>
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import Form from "./components/Form.vue";
import "./style.css";
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main>
      <Form />
    </main>
  </el-config-provider>
</template>

<!-- <style scoped>
main {
  padding: 20px;
}
</style> -->
