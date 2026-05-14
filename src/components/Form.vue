<script setup>
import { bitable } from "@lark-base-open/js-sdk";
import { ElMessage } from "element-plus";
import { ref, onMounted } from "vue";
import request from '@/utils/request'
import ProfileFetch from './ProfileFetch.vue'
import KeywordSearch from './KeywordSearch.vue'
import CommentFetch from './CommentFetch.vue'
import VideoDataFetch from './VideoDataFetch.vue'

const api_key = ref("");
const api_key_disabled = ref(true);
const currentPage = ref("home");

const PLATFORM_LABELS = {
  xhs: '小红书',
  douyin: '抖音',
};
const API_KEY_CLEARED_MARKER = "__cleared__";
const TYPE_OPTIONS = [
  { value: "xhs", label: "小红书" },
  { value: "douyin", label: "抖音" },
]
const social_type_options = ref([...TYPE_OPTIONS]);

onMounted(async () => {
  const key = await bitable.bridge.getData("api_key");
  if (key && typeof key === "string" && key.trim() && key !== API_KEY_CLEARED_MARKER) {
    api_key.value = key;
    await fetchPlatformConfig();
  }
});

const saveApiKey = async () => {
  if (api_key.value === "") {
    api_key_disabled.value = true;
    await bitable.bridge.setData("api_key", API_KEY_CLEARED_MARKER);
    social_type_options.value = [...TYPE_OPTIONS];
    return;
  } else {
    api_key_disabled.value = true;
    await bitable.bridge.setData("api_key", api_key.value);
    ElMessage({ message: "保存成功", type: "success", plain: true });
    await fetchPlatformConfig();
  }
};

const fetchPlatformConfig = async () => {
  try {
    const response = await request({
      url: "/social/api/v1/feishu/social/config",
      method: "get",
      headers: { 'authorization': `Bearer ${api_key.value}` },
    });
    const res = response.data;
    if (res.sta === 0 && Array.isArray(res.data?.value)) {
      social_type_options.value = res.data.value.map(platform => ({
        value: platform,
        label: PLATFORM_LABELS[platform] || platform
      }));
    }
  } catch (error) {
    console.error('获取平台配置失败:', error);
    ElMessage({ message: "获取平台配置失败，使用默认设置", type: "warning", plain: true });
  }
};
</script>

<template>
  <!-- 一级页面：功能入口 -->
  <div v-if="currentPage === 'home'" class="home-page">
    <div class="banner-top"></div>
    <!-- Banner -->
    <div class="banner-section">
      <div class="banner-deco-dot"></div>
      <div class="banner-deco-ring"></div>
      <div class="banner-title">加入沟通群</div>
      <div class="banner-subtitle">
        <span>批量获取博主的</span><span class="highlight">小红薯 / 抖音帖子数据</span>
      </div>
      <a class="banner-btn" href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=75dhf68e-32c8-4955-bc00-1657649b0a16" target="_blank">
        <span>立即进群</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 16 16 12 12 8"></polyline>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
      </a>
    </div>

    <!-- API Key 配置区 -->
    <div class="api-section">
      <div class="api-header">
        <div class="api-title-group">
          <span class="api-title">API Key 设置</span>
          <a class="api-link" href="https://52choujiang.com/assistant" target="_blank">点击获取API密钥</a>
        </div>
        <div class="api-edit" @click="api_key_disabled = !api_key_disabled">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </div>
      </div>
      <div class="api-input-wrap">
        <el-input type="password" v-model="api_key" class="arco-input" placeholder="" :disabled="api_key_disabled"
          show-password />
      </div>
      <div v-if="!api_key_disabled" class="api-save-btn" @click="saveApiKey">
        <img src="https://cdn.zhinizhushou.com/material/20250826/2db36bfc55033175693a18a5f927d938.png"
          style="width: 14px; height: 14px; margin-right: 8px" />
        保存
      </div>
    </div>

    <!-- 功能分组卡片区 -->
    <div class="cards-section">
      <div class="group-title">社媒数据助手</div>
      <div class="cards-grid">
        <div class="arco-card" @click="currentPage = 'video'">
          <div class="func-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
              <polyline points="9 10 12 7 15 10"></polyline>
            </svg>
          </div>
          <span class="func-name">音视频数据获取</span>
        </div>
        <div class="arco-card" @click="currentPage = 'profile'">
          <div class="func-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            </svg>
          </div>
          <span class="func-name">主页批量获取</span>
        </div>
        <div class="arco-card" @click="currentPage = 'search'">
          <div class="func-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <span class="func-name">关键词搜索获取</span>
        </div>
        <div class="arco-card" @click="currentPage = 'comment'">
          <div class="func-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <span class="func-name">评论列表获取</span>
        </div>
      </div>
    </div>
  </div>

  <!-- 二级页面：主页批量获取 -->
  <ProfileFetch v-if="currentPage === 'profile'" :api_key="api_key" @back="currentPage = 'home'" />

  <!-- 二级页面：关键词搜索获取 -->
  <KeywordSearch v-if="currentPage === 'search'" :api_key="api_key" :social_type_options="social_type_options" @back="currentPage = 'home'" />

  <!-- 二级页面：评论列表获取 -->
  <CommentFetch v-if="currentPage === 'comment'" :api_key="api_key" @back="currentPage = 'home'" />

  <!-- 二级页面：音视频数据获取 -->
  <VideoDataFetch v-if="currentPage === 'video'" :api_key="api_key" @back="currentPage = 'home'" />
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  background: #F7F8FA;
}

/* Banner */
.banner-top {
  padding: 10px
}
.banner-section {
  margin: 0px 20px 20px 20px;
  padding: 20px 20px 20px;
  background: linear-gradient(135deg, #FFF0F2 0%, #FFE6E9 100%);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}
.banner-section::before {
  content: '';
  position: absolute;
  top: -24px;
  right: -24px;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: #FFB3BB;
  opacity: 0.15;
  filter: blur(24px);
  z-index: 0;
  pointer-events: none;
}
.banner-section::after {
  content: '';
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 64px;
  height: 64px;
  border-radius: 12px;
  border: 2px solid #FFF0F2;
  opacity: 0.12;
  z-index: 0;
  pointer-events: none;
}
.banner-deco-dot {
  position: absolute;
  bottom: 28px;
  right: 28px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #FFB3BB;
  opacity: 0.18;
  z-index: 0;
  pointer-events: none;
}
.banner-deco-ring {
  position: absolute;
  top: 16px;
  right: 56px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.5px solid #FFF0F2;
  opacity: 0.14;
  z-index: 0;
  pointer-events: none;
}
.banner-title {
  font-size: 20px;
  font-weight: 600;
  color: #1D2129;
  line-height: 28px;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}
.banner-subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
  color: #4E5969;
}
.banner-subtitle .highlight {
  color: #A8071A;
  font-weight: 500;
}
.banner-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 32px;
  font-size: 14px;
  font-weight: 500;
  color: #FFFFFF;
  background: #A8071A;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  text-decoration: none;
  position: relative;
  z-index: 1;
}
.banner-btn:hover { background: #C11126; }
.banner-btn:active { background: #8A0515; }
.banner-btn svg {
  width: 14px;
  height: 14px;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: #FFFFFF;
}

/* API Key 区 */
.api-section {
  margin: 20px 20px 0;
  padding: 16px;
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  box-sizing: border-box;
}
.api-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.api-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.api-title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
  line-height: 24px;
}
.api-link {
  font-size: 13px;
  color: #A8071A;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 20px;
  padding: 2px 6px;
  border-radius: 4px;
}
.api-link:hover {
  background: #FFF0F2;
  opacity: 0.85;
}
.api-edit {
  width: 18px;
  height: 18px;
  cursor: pointer;
  color: #86909C;
  transition: color 0.2s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.api-edit:hover { color: #A8071A; }
.api-edit svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.api-input-wrap {
  position: relative;
}
.api-save-btn {
  margin-top: 12px;
  background: #A8071A;
  width: 100%;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}
.api-save-btn:hover { background: #C11126; }
.api-save-btn:active { background: #8A0515; }

/* 功能分组卡片区 */
.cards-section {
  padding: 32px 20px 32px;
  box-sizing: border-box;
}
.group-title {
  font-size: 14px;
  font-weight: 400;
  color: #86909C;
  margin-bottom: 8px;
  letter-spacing: 0.3px;
  line-height: 22px;
}
.cards-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

/* 卡片 */
.arco-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 22px 8px 20px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.arco-card .func-icon {
  width: 24px;
  height: 24px;
  margin-bottom: 10px;
  color: #A8071A;
  display: flex;
  align-items: center;
  justify-content: center;
}
.arco-card .func-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.arco-card .func-name {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  text-align: center;
  line-height: 22px;
}
.arco-card:hover {
  background: #FFF0F2;
  border-color: #A8071A;
  box-shadow: 0 2px 8px rgba(168, 7, 26, 0.1);
}
.arco-card:hover .func-icon { color: #A8071A; }
.arco-card:hover .func-name { color: #1D2129; }
.arco-card:active {
  background: #FFB3BB;
  border-color: #8A0515;
  box-shadow: none;
}
.arco-card:active .func-icon { color: #8A0515; }
.arco-card:active .func-name { color: #8A0515; }
</style>
