<script setup>
import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ref, onMounted } from "vue";
import request from '@/utils/request'

let profile_timer = null;
let search_timer = null;

const api_key = ref("");
const api_key_disabled = ref(true);

const activeName = ref("1");
const formData = ref({ radio: 1, url: "", pages: 1 });
const formData1 = ref({
  radio: 1,
  social_type: 'douyin', // "xhs",
  keyword: "",
  sort_type: 0, // xhs
  filter_note_type: 0, // xhs
  filter_note_time: 0, // xhs
  publish_time: 0, // douyin
  filter_duration: 0, // douyin
  pages: 1,
});
const pages_options = ref([
  {
    value: 0,
    label: "全量获取",
  },
  {
    value: 1,
    label: "仅获取首页",
  },
  {
    value: 5,
    label: "获取前5页",
  },
  {
    value: 10,
    label: "获取前10页",
  },
  {
    value: 20,
    label: "获取前20页",
  },
  {
    value: 30,
    label: "获取前30页",
  },
  {
    value: 50,
    label: "获取前50页",
  },
]);
const social_type_options = ref([
  // {
  //   value: "xhs",
  //   label: "小红书",
  // },
  {
    value: "douyin",
    label: "抖音",
  },
]);
const douyin_sort_type_options = ref([
  {
    value: 0,
    label: "综合",
  },
  {
    value: 1,
    label: "最多点赞",
  },
  {
    value: 2,
    label: "最多发布",
  },
]);
const xhs_sort_type_options = ref([
  {
    value: 0,
    label: "综合",
  },
  {
    value: 1,
    label: "最热",
  },
  {
    value: 2,
    label: "最新",
  },
  {
    value: 3,
    label: "最多评论",
  },
  {
    value: 4,
    label: "最多收藏",
  },
]);
const filter_note_type_options = ref([
  {
    value: 0,
    label: "综合笔记",
  },
  {
    value: 1,
    label: "视频笔记",
  },
  {
    value: 2,
    label: "图文笔记",
  },
]);
const time_options = ref([
  {
    value: 0,
    label: "不限",
  },
  {
    value: 1,
    label: "一天之内",
  },
  {
    value: 2,
    label: "一周之内",
  },
  {
    value: 3,
    label: "半年之内",
  },
]);
const filter_duration_options = ref([
  {
    value: 0,
    label: "不限",
  },
  {
    value: 1,
    label: "1分钟以下",
  },
  {
    value: 2,
    label: "1-5分钟",
  },
  {
    value: 3,
    label: "5分钟以上",
  },
]);

const loading = ref(false);
let page = 1;
const page_size = 20;
let total = 0;

onMounted(async () => {
  const key = await bitable.bridge.getData("api_key");
  if (key && typeof key === "string") {
    api_key.value = key;
  }
  const profile_url = await bitable.bridge.getData("profile_url");
  const search_platform = await bitable.bridge.getData("search_platform");
  const search_keyword = await bitable.bridge.getData("search_keyword");
  if (profile_url && typeof profile_url == "string") {
    formData.value.url = profile_url;
  }
  if (search_keyword && typeof search_keyword == "string") {
    formData1.value.keyword = search_keyword;
  }
  if (search_platform && typeof search_platform == "string") {
    formData1.value.social_type = search_platform;
  }
});

const saveApiKey = async () => {
  if (api_key.value === "") {
    return;
  } else {
    api_key_disabled.value = true;
    bitable.bridge.setData("api_key", api_key.value);
    ElMessage({
      message: "保存成功",
      type: "success",
      plain: true,
    });
  }
};

const handleClick = (tab, event) => {
  // console.log(tab, event);
};

// 获取数据
// const list = [
//   {
//     "aweme_id": "7489802064457977099",
//     "title": "一口气看完，从一颗细胞到恐龙再到人类，地球40亿年生命进化史 #神奇动物在抖音 #动物世界 #史前巨兽 #涨知识 #我们星球上的生命",
//     "tags": "#神奇动物在抖音 #动物世界 #史前巨兽 #涨知识 #我们星球上的生命",
//     "user_id": 2546116348088446,
//     "nickname": "生物科普频道",
//     "digg_count": 15976,
//     "comment_count": 488,
//     "collect_count": 7704,
//     "share_count": 2532,
//     "share_url": "https://www.iesdouyin.com/share/video/7489802064457977099/?region=CN&mid=7489804212239387403&u_code=163dhmj1j&did=MS4wLjABAAAA0I2Fvf0q86KfatgObYhpWwORula16zHvO5QfGLuOo_VB_nKpjB3_NUa0dZ8xzlro&iid=MS4wLjABAAAANwkJuWIRFOzg5uCpDRpMj4OX-QryoDgn-yYlXQnRwQQ&with_sec_did=1&video_share_track_ver=&titleType=title&share_sign=zsBi4GDwFD7P.g5p9.YOiFL2kqZ1IXu2p7LGuI3MN0E-&share_version=190600&ts=1758101124&from_aid=6383&from_ssr=1&share_track_info=%7B%22link_description_type%22%3A%22%22%7D",
//     "play_url": "https://www.douyin.com/aweme/v1/play/?video_id=v0d00fg10000cvohssnog65sqil2vuc0&line=0&file_id=cc712c5a15504925bc3bf2b53616a7c4&sign=5d722aeaf56ed178a1ab2f21d4258373&is_play_url=1&source=PackSourceEnum_PUBLISH",
//     "cover_url": "https://p3-pc-sign.douyinpic.com/tos-cn-p-0015/ooeejLz2AOf7AGz8QwIBlUAi3oIB4PPaACCxQq~tplv-dy-360p.jpeg?lk3s=138a59ce&x-expires=1759309200&x-signature=%2BBGUqTcG%2FSCn4JGokkHpoh4UajE%3D&from=327834062&s=PackSourceEnum_PUBLISH&se=false&sc=origin_cover&biz_tag=pcweb_cover&l=20250917172524CD2C6A3997CBF81F5F50",
//     "duration": 2996,
//     "create_time": 1743855820
//   }
// ];

const resetParams = () => {
  loading.value = false;
  page = 1;
  total = 0;
};

// 写入数据: 新建表格
const createAndWriteData = async (list, type, task_id) => {
  if (!list || list.length == 0) {
    ElMessage({
      message: "获取数据异常，请稍后重试",
      type: "warning",
      plain: true,
    });
    resetParams();
    return;
  }
  try {
    const fields = [
      { type: FieldType.Text, name: "视频编号" },
      { type: FieldType.Text, name: "视频标题" },
      { type: FieldType.Text, name: "标签" },
      { type: FieldType.Text, name: "用户ID" },
      { type: FieldType.Text, name: "作者" },
      { type: FieldType.Number, name: "点赞数" }, // Number类型,小红书平台可能不支持，可能返回字符串 12.1万
      { type: FieldType.Number, name: "评论数" },
      { type: FieldType.Number, name: "收藏数" },
      { type: FieldType.Number, name: "分享数" },
      { type: FieldType.Text, name: "下载链接" },
      { type: FieldType.Text, name: "封面" },
      { type: FieldType.Number, name: "时长" },
      { type: FieldType.DateTime, name: "发布时间" },
    ];
    console.log("🚀 ~ createAndWriteData ~ fields:", fields)
    // 创建表格，创建表格中的字段
    if (!type) { // 第一次请求
      let tableName = '';
      if (activeName.value == "1") { // 主页
        const firstItem = list[0];
        tableName = firstItem?.nickname || '社媒数据助手';
      } else if (activeName.value == "2") { // 关键词搜索
        tableName = formData1.value.keyword
      }
      // 创建表格
      const { tableId, index } = await createSequentialTable(tableName);
      const newTable = await bitable.base.getTable(tableId);
      // console.log("🚀 ~ createAndWriteData ~ newTable:", newTable)
      await bitable.ui.switchToTable(tableId);
      // 修改表格中第一个字段
      const first_field = await newTable.getField('文本');
      // 批量添加字段（并行处理提高效率）
      const fieldPromises = fields.map((config, index) => {
        if (index === 0 && first_field) {
          return newTable.setField(first_field.id, {
            ...config,
          })
        }
        return newTable.addField({
          ...config,
        })
      }
      );
      const createdFields = await Promise.all(fieldPromises);
      // console.log(`表格"${tableName}"创建成功，包含${createdFields.length}个字段`);
    }
    // 写入数据
    const activeTable = await bitable.base.getActiveTable();
    // console.log("🚀 ~ createAndWriteData ~ activeTable:", activeTable, fields)
    const fieldList = [];
    for (const config of fields) {
      const field = await activeTable.getField(config.name);
      if (!field) {
        console.error(`表格中未找到字段：${config.name}`);
      }
      fieldList.push(field);
    };
    // console.log("🚀 ~ createAndWriteData ~ fieldList:", fieldList)
    if (fieldList.length != fields.length) {
      console.error(`表格中获取的字段错误：` + fieldList.length);
      return;
    }
    let records = [];
    for (const item of list) {
      let record = [];
      record.push(await fieldList[0].createCell(item.aweme_id));
      record.push(await fieldList[1].createCell(item.title));
      record.push(await fieldList[2].createCell(item.tags));
      record.push(await fieldList[3].createCell(item.user_id));
      record.push(await fieldList[4].createCell(item.nickname));
      await fieldList[5].setFormatter(NumberFormatter.INTEGER);
      record.push(await fieldList[5].createCell(item.digg_count));
      await fieldList[6].setFormatter(NumberFormatter.INTEGER);
      record.push(await fieldList[6].createCell(item.comment_count));
      await fieldList[7].setFormatter(NumberFormatter.INTEGER);
      record.push(await fieldList[7].createCell(item.collect_count));
      await fieldList[8].setFormatter(NumberFormatter.INTEGER);
      record.push(await fieldList[8].createCell(item.share_count));
      record.push(await fieldList[9].createCell(item.play_url));
      record.push(await fieldList[10].createCell(item.cover_url));
      await fieldList[11].setFormatter(NumberFormatter.INTEGER);
      record.push(await fieldList[11].createCell(item.duration));
      record.push(await fieldList[12].createCell(item.create_time ? item.create_time * 1000 : ''));
      records.push(record);
    }
    // 写入记录
    const recordIds = await activeTable.addRecords(records);
    // console.log(`成功添加 ${recordIds.length} 条数据`, ' - ' + total + ' - ', page + ' - ', total > page);

    if (total > page) {
      page += 1;
      getList(task_id, 'next');
      return;
    } else {
      resetParams();
    }
  } catch (error) {
    console.error("🚀 ~ createAndWriteData ~ error:", error)
    resetParams();
  }
}

// 新建 顺序表
const createSequentialTable = async (baseTableName) => {
  try {
    // 获取所有表格元信息
    const existingTables = await bitable.base.getTableMetaList();
    const tableNames = existingTables.map(table => table.name);

    // 检查是否存在基础名称表格（无序号）或存在有序号的表格
    const existsBaseTable = tableNames.includes(baseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${baseTableName}`) && /\d+$/.test(name.slice(baseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      // 存在基础表，直接创建基础名称表格
      const newTable = await bitable.base.addTable({
        name: baseTableName
      });
      // console.log(`已创建基础表格：${baseTableName}，ID：${newTable.id}`);
      return newTable;
    }

    // 存在基础表，查找最大序号
    // 正则匹配格式：基础名+数字（如"视频信息表1"）
    const reg = new RegExp(`^${baseTableName}(\\d+)$`);
    let maxIndex = 0;

    tableNames.forEach(name => {
      const match = name.match(reg);
      if (match) {
        // 提取数字部分并转换为整数
        const index = parseInt(match[1], 10);
        // 更新最大序号
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    });

    // 计算新表格名称（最大序号+1）
    const newTableName = `${baseTableName}${maxIndex + 1}`;

    // 创建新表格
    const newTable = await bitable.base.addTable({
      name: newTableName
    });
    // console.log(`已创建序号表格：${newTableName}`);
    return newTable;

  } catch (error) {
    console.error("获取表格序号失败：", error);
    throw error; // 抛出错误便于上层处理
  }
}

const showErrorMsg = (message) => {
  ElMessage({
    message: message,
    type: "error",
    plain: true,
  });
};

// 主页 提交任务
const postProfileTask = async () => {
  await request({
    url: "/social/api/v1/feishu/social/task",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
    data: {
      url: formData.value.url,
      pages: Number(formData.value.pages),
    },
  })
    .then(function (response) {
      // loading.value = false;
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getProfileTaskInterval(data.task_id);
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

const closeProfileInterval = () => {
  profile_timer && clearInterval(profile_timer);
  profile_timer = null;
};

// 主页 轮询获取任务状态
const getProfileTaskInterval = (task_id) => {
  const requestFn = () => {
    let time = 0;
    closeProfileInterval();
    profile_timer = setInterval(() => {
      time += 3;
      if (time >= 600) {
        closeProfileInterval();
        showErrorMsg("获取数据超时，请稍后重试");
        loading.value = false;
      } else {
        getProfileTask(task_id);
        console.log('time: ~~~~~~', time);
      }
    }, 3000)
  }
  requestFn();
};

// 主页 获取任务状态
const getProfileTask = async (task_id) => {
  await request({
    url: "/social/api/v1/feishu/social/task?task_id=" + task_id,
    method: "get",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { status } = res.data;
        if (status == 0) { // 进行中
          // 继续轮询
        } else if (status == 1) { // 成功
          closeProfileInterval();
          page = 1;
          getList(task_id);
        } else if (status == 2) { // 失败
          closeProfileInterval();
          showErrorMsg("获取数据失败，请稍后重试");
          loading.value = false;
        }
      }
    })
    .catch(function (error) {
      console.log(error);
    });
}

// 获取帖子列表
const getList = async (task_id, type) => {
  await request({
    url: "/social/api/v1/feishu/post/list",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
    data: {
      task_id: task_id,
      page: page,
      page_size: page_size,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { count, data } = res.data;
        if (!type) { // 第一次请求
          total = Math.ceil(count / page_size);
          createAndWriteData(data, '', task_id);
        } else if (type == 'next') {
          createAndWriteData(data, type, task_id);
        }
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

// 主页数据
const getProfileData = async () => {
  // 新建表格，表格中第一个字段为视频编号
  // createAndWriteData([]);
  // return;
  loading.value = true;
  await postProfileTask();
};

const getSearchTask = async (task_id) => {
  await request({
    url: "/social/api/v1/feishu/keyword/task?task_id=" + task_id,
    method: "get",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { status } = res.data;
        if (status == 0) { // 进行中
          // 继续轮询
        } else if (status == 1) { // 成功
          closeSearchInterval();
          page = 1;
          getList(task_id);
        } else if (status == 2) { // 失败
          closeSearchInterval();
          showErrorMsg("获取数据失败，请稍后重试");
          loading.value = false;
        }
      }
    })
    .catch(function (error) {
      console.log(error);
    });
}

const closeSearchInterval = () => {
  search_timer && clearInterval(search_timer);
  search_timer = null;
};

const getSearchTaskInterval = (task_id) => {
  const requestFn = () => {
    let time = 0;
    closeSearchInterval();
    search_timer = setInterval(() => {
      time += 3;
      if (time >= 600) {
        closeSearchInterval();
        showErrorMsg("获取数据超时，请稍后重试");
        loading.value = false;
      } else {
        getSearchTask(task_id);
        console.log('time: ~~~~~~', time);
      }
    }, 3000)
  }
  requestFn();
};

// 关键词搜索 提交任务
const postSearchTask = async () => {
  let filter_config = {};
  if (formData1.value.social_type == 'xhs') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      filter_note_type: formData1.value.filter_note_type,
      filter_note_time: formData1.value.filter_note_time,
    }
  } else if (formData1.value.social_type == 'douyin') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      publish_time: formData1.value.publish_time,
      filter_duration: formData1.value.filter_duration,
    }
  }
  await request({
    url: "/social/api/v1/feishu/keyword/task",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
    data: {
      social_type: formData1.value.social_type,
      keyword: formData1.value.keyword,
      pages: Number(formData1.value.pages),
      filter_config,
    },
  })
    .then(function (response) {
      // loading.value = false;
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getSearchTaskInterval(data.task_id);
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
}

// 关键词搜索数据
const getSearchData = async () => {
  loading.value = true;
  await postSearchTask();
};

const commit = () => {
  if (activeName.value == "1") {
    // 主页批量获取
    // console.log("commit", formData.value);
    const { url } = formData.value;
    if (!String(url)) {
      showErrorMsg("请输入博主主页链接");
      return;
    }
    getProfileData();
    //
    bitable.bridge.setData("profile_url", formData.value.url);
  } else if (activeName.value == "2") {
    // 关键词搜索获取
    // console.log("commit", formData1.value);
    const { keyword } = formData1.value;
    if (!String(keyword)) {
      showErrorMsg("请输入关键词");
      return;
    }
    getSearchData();
    //
    bitable.bridge.setData("search_platform", formData1.value.social_type);
    bitable.bridge.setData("search_keyword", formData1.value.keyword);
  }
};

// 处理数据写入中的异常
const handleError = async (recordId) => { };
</script>

<template>
  <div class="key-box">
    <div class="key-title">
      <div>
        API key 设置
        <a class="key-url" href="https://52choujiang.com/assistant" target="_blank">获取API秘钥</a>
      </div>
      <img src="https://cdn.zhinizhushou.com/material/20250826/7cbcdd6c440e86fdf51c553973211e54.png"
        style="width: 16px; height: 16px; cursor: pointer" alt="" @click="api_key_disabled = !api_key_disabled" />
    </div>
    <el-input type="password" v-model="api_key" class="key-input" placeholder="" :disabled="api_key_disabled"
      show-password />
    <div v-if="!api_key_disabled" class="key-save-btn" @click="saveApiKey">
      <img src="https://cdn.zhinizhushou.com/material/20250826/2db36bfc55033175693a18a5f927d938.png"
        style="width: 14px; height: 14px; margin-right: 8px" />
      保存
    </div>
  </div>
  <div class="create-box">
    <el-tabs v-model="activeName" class="create-tabs" @tab-click="handleClick">
      <el-tab-pane label="主页批量获取" name="1">
        <el-form ref="form" class="form" :model="formData" label-position="top">
          <el-form-item label="" style="margin-top: 12px">
            <el-radio-group v-model="formData.radio">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2" :disabled="true">使用现有表格</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item>
            <div slot="label" class="c-label">
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持博主主页链接，<br />不支持其他链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-input v-model="formData.url" class="c-input" placeholder="" />
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              数据提取范围
              <el-tooltip effect="dark" placement="top">
                <template #content>每页 50 积分，实际扣费会按照<br />提取的页数进行计算</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData.pages" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="关键词搜索获取" name="2">
        <el-form ref="form" class="form" :model="formData1" label-position="top">
          <el-form-item label="" style="margin-top: 12px">
            <el-radio-group v-model="formData1.radio">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2" :disabled="true">使用现有表格</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              平台
              <el-tooltip effect="dark" placement="top">
                <template #content>平台</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.social_type" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in social_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <div slot="label" class="c-label">
              关键词
              <el-tooltip effect="dark" placement="top">
                <template #content>关键词搜索</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-input v-model="formData1.keyword" class="c-input" placeholder="请输入" />
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              排序方式
              <el-tooltip effect="dark" placement="top">
                <template #content>排序方式</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
              <el-option v-if="formData1.social_type == 'douyin'" v-for="tl in douyin_sort_type_options" :key="tl.value"
                :label="tl.label" :value="tl.value" />
              <el-option v-if="formData1.social_type == 'xhs'" v-for="tl in xhs_sort_type_options" :key="tl.value"
                :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="formData1.social_type == 'xhs'">
            <div slot="label" class="c-label">
              笔记类型
              <el-tooltip effect="dark" placement="top">
                <template #content>笔记类型</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.filter_note_type" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in filter_note_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="formData1.social_type == 'xhs'">
            <div slot="label" class="c-label">
              发布时间
              <el-tooltip effect="dark" placement="top">
                <template #content>发布时间</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.filter_note_time" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="formData1.social_type == 'douyin'">
            <div slot="label" class="c-label">
              发布时间
              <el-tooltip effect="dark" placement="top">
                <template #content>发布时间</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.publish_time" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="formData1.social_type == 'douyin'">
            <div slot="label" class="c-label">
              筛选时长
              <el-tooltip effect="dark" placement="top">
                <template #content>筛选时长</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.filter_duration" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in filter_duration_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              数据提取范围
              <el-tooltip effect="dark" placement="top">
                <template #content>每页 50 积分，实际扣费会按照<br />提取的页数进行计算</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.pages" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
  </div>
</template>

<style scoped>
.key-box {
  padding: 20px 16px 0;
  box-sizing: border-box;
}

.key-box .key-title {
  font-size: 14px;
  font-weight: normal;
  line-height: 22px;
  letter-spacing: 0px;
  color: #1d2129;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.key-box .key-url {
  color: #165dff;
  text-decoration: none;
}

.key-box .key-input {
  width: 100%;
  margin-top: 24px;
}

.key-box .key-save-btn {
  background: #a8071a;
  width: 100%;
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  margin-top: 24px;
  cursor: pointer;
}

.create-box {
  padding: 40px 16px 40px;
  box-sizing: border-box;
}

.form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #1d2129;
  margin-bottom: 8px;
}

.form :deep(.el-form-item__content) {
  font-size: 14px;
}

.create-tabs {}

.commit-btn {
  background: #a8071a;
  width: 100%;
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  margin-top: 8px;
  cursor: pointer;
}

.c-label {
  display: flex;
  align-items: center;
}

.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}
</style>
