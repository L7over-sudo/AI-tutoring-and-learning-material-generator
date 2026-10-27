<template>
  <section class="panel source-launch-panel">
    <el-button class="pink-button" @click="dialogVisible.image = true">📁 导入图片</el-button>
    <el-button class="pink-outline" @click="dialogVisible.text = true">📝 图文生图</el-button>
    <el-button class="pink-outline" @click="dialogVisible.documentImage = true">📄 文档生图</el-button>
    <el-button class="pink-outline" @click="dialogVisible.documentPpt = true">📊 文档生PPT</el-button>
    <el-button class="pink-outline" @click="dialogVisible.convert = true">🖼️ 格式转换</el-button>
    <el-button class="pink-outline" @click="dialogVisible.wordSplit = true">📄 Word 拆分</el-button>
    <el-button class="pink-outline" @click="dialogVisible.pdfShuffle = true">🔀 PDF 排序</el-button>
    <el-button class="pink-outline" @click="openPdfWatermarkDialog">💧 PDF 水印</el-button>
    <el-button class="pink-outline" @click="dialogVisible.imageWatermark = true">🖼️ 图片水印</el-button>
    <el-button class="pink-outline" @click="dialogVisible.markdownEditor = true">📝 Markdown 编辑器</el-button>
    <el-button class="pink-outline" @click="openHtmlEditorDialog">🌐 HTML 编辑器</el-button>
    <el-button class="pink-outline" @click="dialogVisible.storyboard = true">🎬 分镜</el-button>
    <el-button class="pink-outline" @click="dialogVisible.imageStitch = true">🧩 图片拼接</el-button>
    <el-button class="pink-outline" @click="dialogVisible.xhsParse = true">🎬 作品解析</el-button>
  </section>

  <el-dialog v-model="dialogVisible.image" title="📁 导入图片" width="760px" class="source-dialog" @closed="resetImageDialog">
    <div class="source-tab-head">
      <span>批量上传教辅图片，作为 AI 重绘参考</span>
      <el-input v-model="folderName" placeholder="文件夹名称，例如：三年级数学练习" clearable />
    </div>
    <el-upload
      class="upload-box"
      drag
      multiple
      accept=".jpg,.jpeg,.png,.webp"
      :auto-upload="false"
      :show-file-list="false"
      :on-change="onPick"
    >
      <div class="upload-emoji">🌸</div>
      <div class="upload-text">拖拽图片到这里，或点击选择多张图片</div>
      <div class="upload-hint">支持 jpg / jpeg / png / webp，单张最大 20MB</div>
    </el-upload>
    <div class="upload-actions">
      <el-button class="pink-button" :loading="taskStore.uploading" @click="submitPicked">📁 上传选中图片</el-button>
      <el-button class="pink-outline" @click="folderInput?.click()">🗂️ 文件夹上传</el-button>
      <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onFolderChange" />
    </div>
    <div v-if="pickedPreviews.length" class="picked-preview-panel">
      <div class="picked-preview-head">
        <span>已选择 {{ pickedPreviews.length }} 张图片</span>
        <el-button link type="danger" @click="clearPicked">清空</el-button>
      </div>
      <div class="picked-preview-grid">
        <figure v-for="item in pickedPreviews" :key="item.url">
          <img :src="item.url" :alt="item.name" />
          <figcaption>{{ item.name }}</figcaption>
        </figure>
      </div>
    </div>
  </el-dialog>

  <el-dialog v-model="dialogVisible.text" title="📝 图文参考生成" width="900px" class="source-dialog text-image-dialog" @closed="resetTextDialog">
    <div
      class="text-source-body"
      :class="{ 'is-dragging-doc': draggingDocument }"
      @dragenter.prevent="onTextDragEnter"
      @dragover.prevent="onTextDragOver"
      @dragleave.prevent="onTextDragLeave"
      @drop.prevent="onTextDocumentDrop"
    >
      <div class="form-grid">
        <el-form-item label="作品标题">
          <el-input v-model="textForm.title" placeholder="例如：三上语文复习卡片" />
        </el-form-item>
        <el-form-item label="生成张数">
          <div class="count-field-with-hint">
            <el-input-number v-model="textForm.count" :min="1" :max="1000" />
            <span class="muted">同一提示词和参考图生成多张变体</span>
          </div>
        </el-form-item>
        <el-form-item label="画布" class="text-reference-canvas-field">
          <div class="text-reference-size-grid">
            <el-select v-model="textReferenceForm.size">
              <el-option label="原尺寸" value="原尺寸" />
              <el-option label="3:4 小红书竖图" value="3:4" />
              <el-option label="1:1 方图" value="1:1" />
              <el-option label="2:3 标准竖图" value="2:3" />
              <el-option label="4:5 竖图" value="4:5" />
              <el-option label="9:16 长竖图" value="9:16" />
              <el-option label="1:2 超长竖图" value="1:2" />
              <el-option label="9:21 超长海报" value="9:21" />
              <el-option label="4:3 横图" value="4:3" />
              <el-option label="3:2 横图" value="3:2" />
              <el-option label="16:9 横版封面" value="16:9" />
              <el-option label="21:9 宽屏横图" value="21:9" />
            </el-select>
            <el-select v-model="textReferenceForm.quality">
              <el-option v-for="opt in textReferenceQualityOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
        </el-form-item>
      </div>
      <el-form-item label="参考图">
        <div class="text-reference-upload">
          <el-upload
            ref="textReferenceUpload"
            class="upload-box text-reference-uploader"
            drag
            accept=".jpg,.jpeg,.png,.webp"
            :auto-upload="false"
            :show-file-list="false"
            :on-change="onReferenceImagePick"
          >
            <template v-if="textReferencePreview">
              <img :src="textReferencePreview.url" :alt="textReferencePreview.name" class="text-reference-preview-img" />
              <div class="upload-hint">{{ textReferencePreview.name }}</div>
            </template>
            <template v-else>
              <div class="upload-emoji">🖼️</div>
              <div class="upload-text">上传一张参考图</div>
              <div class="upload-hint">用于参考版式、配色和构图，不直接套用右侧模板面板</div>
            </template>
          </el-upload>
          <el-button v-if="textReferencePreview" class="soft-button" @click="clearReferenceImage">清空参考图</el-button>
        </div>
      </el-form-item>
      <el-form-item label="提示词">
        <div class="text-drop-zone">
          <el-input
            v-model="textForm.sourceText"
            type="textarea"
            :rows="7"
            resize="none"
            placeholder="输入你想生成的画面要求。比如：根据参考图生成一张同风格产品海报；或生成一张三角函数知识卡片；或保留参考图氛围，换成春日花园场景。"
          />
          <div v-if="draggingDocument" class="text-drop-mask">松开即可上传文档 ✨</div>
        </div>
      </el-form-item>
      <div class="text-source-actions">
        <el-upload
          ref="textDocumentUpload"
          accept=".txt,.md,.docx,.pdf"
          multiple
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onDocumentPick"
        >
          <el-button class="pink-outline" :loading="extracting">📄 上传文档</el-button>
        </el-upload>
        <span v-if="textForm.documentName" class="muted">已读取：{{ textForm.documentName }}</span>
        <el-button class="pink-button" :loading="taskStore.generating" @click="submitTextTasks">
          🎨 立即生成
        </el-button>
      </div>
    </div>
  </el-dialog>

  <el-dialog v-model="dialogVisible.documentImage" title="📄 文档生图" width="900px" class="source-dialog document-image-dialog" @closed="resetDocumentImageDialog">
    <div class="document-image-body">
      <div class="document-image-head">
        <div>
          <b>上传文档后自动转成页面图片</b>
          <span>适合 Word、PDF、TXT、Markdown 资料；自动跳过空白页，保留有内容的页面和原始文档。</span>
        </div>
        <el-checkbox v-model="documentImageAutoStart">转图后自动开始绘制</el-checkbox>
      </div>

      <div class="convert-settings-grid document-image-settings">
        <el-form-item label="图片格式">
          <el-select v-model="convertSettings.imageFormat">
            <el-option label="PNG" value="png" />
            <el-option label="JPG" value="jpeg" />
            <el-option label="WebP" value="webp" />
          </el-select>
        </el-form-item>
        <el-form-item label="清晰度">
          <el-select v-model="convertSettings.resolution">
            <el-option label="1K" value="1k" />
            <el-option label="2K" value="2k" />
            <el-option label="4K" value="4k" />
          </el-select>
        </el-form-item>
        <el-form-item label="独立文件夹">
          <el-checkbox v-model="convertSettings.separateFolder">按文档名整理页面图片</el-checkbox>
        </el-form-item>
      </div>

      <el-upload
        class="upload-box document-image-uploader"
        drag
        accept=".pdf,.docx,.txt,.md"
        :auto-upload="false"
        :show-file-list="false"
        :on-change="onDocumentImagePick"
      >
        <div class="upload-emoji">📄</div>
        <div class="upload-text">拖拽文档到这里，或点击选择文档</div>
        <div class="upload-hint">支持 pdf / docx / txt / md，上传后自动转图并创建生图任务</div>
      </el-upload>

      <div class="document-image-actions">
        <span v-if="documentImageFile" class="muted">当前文档：{{ documentImageFile.name }}</span>
        <el-button class="pink-button" :loading="documentImageConverting" :disabled="!documentImageFile" @click="runDocumentImageGeneration()">
          重新转图并创建任务
        </el-button>
      </div>

      <div v-if="documentImageResult.originalFile || documentImageResult.downloadUrl" class="document-image-result-links">
        <span v-if="documentImageResult.originalFile">原文档已保留：{{ documentImageResult.originalFile.name }}</span>
        <div>
          <el-button v-if="documentImageResult.originalFile?.url" link type="primary" @click="open(documentImageResult.originalFile.url)">打开原文档</el-button>
          <el-button v-if="documentImageResult.downloadUrl" link type="primary" @click="open(documentImageResult.downloadUrl)">下载图片包</el-button>
        </div>
      </div>

      <div v-if="documentImageConverting || documentImageProgress.percent" class="document-image-progress">
        <div class="convert-progress-title">
          <span>{{ documentImageProgress.label }}</span>
          <span class="muted">{{ documentImageProgress.detail }}</span>
        </div>
        <el-progress :percentage="documentImageProgress.percent" :status="documentImageProgress.status" />
      </div>

      <div v-if="documentImageStatus" class="document-image-status">{{ documentImageStatus }}</div>

      <div v-if="documentImageResult.pages.length" class="converted-grid document-image-preview-grid">
        <figure v-for="page in documentImageResult.pages" :key="page.url" @click="open(page.url)">
          <img :src="page.url" :alt="page.name" />
          <figcaption>第 {{ page.index }} 页</figcaption>
        </figure>
      </div>
    </div>
  </el-dialog>

  <DocumentPptDialog v-model="dialogVisible.documentPpt" />

  <el-dialog v-model="dialogVisible.convert" title="🖼️ 格式转换" width="980px" class="source-dialog convert-dialog">
    <div class="convert-tool-body">
      <div class="convert-settings-grid">
        <el-form-item label="源文件夹选择" class="convert-source-field">
          <div class="inline-field source-picker-field">
            <el-input :model-value="convertSummary" placeholder="支持选择文件或文件夹" readonly />
            <el-button class="pink-outline" @click="convertFileInput?.click()">选择文件</el-button>
            <el-button class="pink-outline source-picker-button" @click="sourceFolderInput?.click()">选择文件夹</el-button>
          </div>
          <input ref="convertFileInput" type="file" multiple hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.jpg,.jpeg,.png,.webp" @change="onConvertFilesChange" />
          <input ref="sourceFolderInput" type="file" webkitdirectory multiple hidden @change="onSourceFolderChange" />
        </el-form-item>
        <el-form-item label="输出文件夹">
          <div class="inline-field">
            <el-input v-model="convertSettings.outputFolder" placeholder="选择输出文件夹或输入本机路径" clearable @clear="clearOutputFolder" />
            <el-button class="pink-outline" @click="pickOutputFolder">选择文件夹</el-button>
          </div>
        </el-form-item>
        <el-form-item label="图片格式">
          <el-select v-model="convertSettings.imageFormat">
            <el-option label="PNG" value="png" />
            <el-option label="JPG" value="jpeg" />
            <el-option label="WebP" value="webp" />
          </el-select>
        </el-form-item>
        <el-form-item label="清晰度">
          <el-select v-model="convertSettings.resolution">
            <el-option label="1K" value="1k" />
            <el-option label="2K" value="2k" />
            <el-option label="4K" value="4k" />
          </el-select>
        </el-form-item>
        <el-form-item label="PDF/PPT 文件名">
          <el-input v-model="convertSettings.fileName" placeholder="图片合并文件名" clearable />
        </el-form-item>
        <el-form-item label="独立文件夹">
          <el-checkbox v-model="convertSettings.separateFolder">为每个文件创建独立图片文件夹</el-checkbox>
        </el-form-item>
      </div>

      <div class="convert-actions">
        <el-button class="pink-button" :loading="converting" :disabled="!documentFiles.length" @click="runDocumentToImages">文档转图片</el-button>
        <el-button class="pink-button" :loading="converting" :disabled="!presentationFiles.length" @click="runPresentationToImages">PPT转图片</el-button>
        <el-button class="pink-button" :loading="converting" :disabled="!imageFiles.length" @click="runImagesToPdf">图片转PDF</el-button>
        <el-button class="pink-button" :loading="converting" :disabled="!imageFiles.length" @click="runImagesToPpt">图片转PPT</el-button>
        <el-button class="pink-button" :loading="converting" :disabled="!pdfFiles.length" @click="runPdfToWord">PDF转Word</el-button>
        <el-dropdown trigger="click" :disabled="convertFiles.length < 2 || converting" @command="handleConvertSortCommand">
          <el-button class="soft-button" :disabled="convertFiles.length < 2 || converting">排序</el-button>
          <template #dropdown>
            <el-dropdown-menu class="convert-sort-menu">
              <el-dropdown-item command="key:default"><span class="sort-check">{{ convertSort.key === "default" ? "✓" : "" }}</span>默认</el-dropdown-item>
              <el-dropdown-item command="key:name"><span class="sort-check">{{ convertSort.key === "name" ? "✓" : "" }}</span>文件名</el-dropdown-item>
              <el-dropdown-item command="key:created"><span class="sort-check">{{ convertSort.key === "created" ? "✓" : "" }}</span>创建时间</el-dropdown-item>
              <el-dropdown-item command="key:modified"><span class="sort-check">{{ convertSort.key === "modified" ? "✓" : "" }}</span>修改时间</el-dropdown-item>
              <el-dropdown-item command="key:size"><span class="sort-check">{{ convertSort.key === "size" ? "✓" : "" }}</span>大小</el-dropdown-item>
              <el-dropdown-item command="key:type"><span class="sort-check">{{ convertSort.key === "type" ? "✓" : "" }}</span>类型</el-dropdown-item>
              <el-dropdown-item divided command="order:asc"><span class="sort-check">{{ convertSort.order === "asc" ? "✓" : "" }}</span>递增</el-dropdown-item>
              <el-dropdown-item command="order:desc"><span class="sort-check">{{ convertSort.order === "desc" ? "✓" : "" }}</span>递减</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button class="pink-outline" @click="saveConvertSettings">保存设置</el-button>
        <el-button class="soft-button" :disabled="!converting" @click="cancelConversion">取消</el-button>
        <el-button class="soft-button" :disabled="!convertFiles.length || converting" @click="clearConvertFiles">清空</el-button>
      </div>
      <div v-if="presentationFiles.length && convertSettings.resolution === '4k'" class="muted">
        PPT 以 4K 转图片时会自动压缩，保证每张图片不超过 5MB。
      </div>

      <div v-if="convertFiles.length" class="convert-order-preview">
        <div class="convert-order-head">
          <b>当前顺序</b>
          <span>{{ convertSortText }}</span>
        </div>
        <ol>
          <li v-for="item in visibleConvertFileOrder" :key="item.key">{{ item.name }}</li>
        </ol>
        <p v-if="hiddenConvertFileOrderCount">还有 {{ hiddenConvertFileOrderCount }} 个文件，转换时会继续按当前规则排序。</p>
      </div>
      <div v-if="convertJobs.length" class="convert-progress-list">
        <div class="convert-progress-overview">
          <div class="convert-progress-title">
            <span>处理进度</span>
            <span class="muted">{{ convertProgressText }}</span>
          </div>
          <el-progress :percentage="convertOverallProgress" :status="convertOverallStatus" />
        </div>
        <div v-for="job in convertJobs" :key="job.id" class="convert-progress-item">
          <div class="convert-progress-title">
            <span>{{ job.name }}</span>
            <span class="muted">{{ job.message }}</span>
          </div>
          <el-progress :percentage="job.progress" :status="job.status === 'error' ? 'exception' : job.status === 'success' ? 'success' : undefined" />
          <div class="convert-job-actions">
            <el-button v-if="job.downloadUrl" link type="primary" @click="downloadConverted(job)">{{ job.type === "ppt" ? "下载 PPT" : job.type === "word" ? "下载 Word" : "下载结果" }}</el-button>
            <el-button v-if="job.pdfUrl" link type="primary" @click="open(job.pdfUrl)">预览 PDF</el-button>
          </div>
        </div>
      </div>

      <div v-if="convertLogs.length" class="convert-log-box">
        <div v-for="log in convertLogs" :key="log.id" :class="['convert-log-line', log.level]">
          <span>{{ log.time }}</span>
          <b>{{ log.levelText }}</b>
          <p>{{ log.message }}</p>
        </div>
      </div>

      <div v-if="convertResult.pages.length" class="converted-result-panel">
        <div class="converted-result-head">
          <div>
            <b>转换结果</b>
            <span>已生成 {{ convertResult.pages.length }} 张图片，当前预览 {{ visibleConvertedPages.length }} 张</span>
          </div>
          <el-button v-if="convertResult.downloadUrl" link type="primary" @click="downloadConverted()">下载全部结果</el-button>
        </div>
        <div class="converted-grid">
          <figure v-for="page in visibleConvertedPages" :key="page.url" @click="open(page.url)">
            <img :src="page.url" :alt="page.name" loading="lazy" />
            <figcaption>第 {{ page.index }} 页</figcaption>
          </figure>
        </div>
        <div v-if="hiddenConvertedPageCount" class="converted-more">
          还有 {{ hiddenConvertedPageCount }} 张图片未在页面预览，可下载 ZIP 查看全部图片。
        </div>
      </div>
      <div v-else class="convert-empty">上传 Word / PDF 后，转换结果会显示在这里 ✨</div>
    </div>
  </el-dialog>

  <el-dialog v-model="dialogVisible.wordSplit" title="📄 Word 文档拆分" width="900px" class="source-dialog word-split-dialog">
    <section class="word-split-panel">
      <div class="word-split-head">
        <div>
          <b>Word 文档拆分</b>
          <span>按正文段落拆成约 5000 字一个板块，并打包下载。</span>
        </div>
        <el-tag type="danger" effect="plain">默认 5000 字/块</el-tag>
      </div>

      <div class="word-split-tools">
        <el-upload
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onSplitDocumentPick"
        >
          <el-button class="pink-outline" :loading="splitProcessing">选择 Word 文档</el-button>
        </el-upload>
        <el-form-item label="每块字数">
          <el-input-number v-model="splitChars" :min="100" :max="50000" :step="100" @change="refreshSplitPreview" />
        </el-form-item>
        <el-button class="pink-button" :loading="splitProcessing" :disabled="!splitFile || !splitGroups.length" @click="downloadSplitPackage">
          拆分并下载 ZIP
        </el-button>
        <el-button class="soft-button" :disabled="!splitFile || splitProcessing" @click="clearSplitDocument">清空拆分</el-button>
      </div>

      <div v-if="splitFile" class="word-split-summary">
        <span>文档：<b>{{ splitFile.name }}</b></span>
        <span>正文约 <b>{{ formatNumber(splitTotalChars) }}</b> 字</span>
        <span>内容块 <b>{{ formatNumber(splitBlocks.length) }}</b> 个</span>
        <span>预计 <b>{{ formatNumber(splitGroups.length) }}</b> 个文件</span>
      </div>

      <div v-if="splitLongBlock" class="word-split-warning">
        有单个段落或表格超过当前字数上限，工具会保留完整内容块，不会从中间硬切。
      </div>

      <div v-if="splitGroups.length" class="word-split-list">
        <div v-for="(group, index) in splitGroups" :key="index" class="word-split-item">
          <b>第 {{ index + 1 }} 部分</b>
          <span>约 {{ formatNumber(group.length) }} 字，{{ formatNumber(group.blockCount) }} 个内容块</span>
        </div>
      </div>
      <div v-else class="word-split-empty">上传 .docx 后，这里会显示 5000 字板块预览。</div>
    </section>
  </el-dialog>

  <el-dialog v-model="dialogVisible.pdfShuffle" title="🔀 PDF 随机排序工具" width="900px" class="source-dialog pdf-shuffle-dialog">
    <section class="pdf-shuffle-panel">
      <div class="word-split-head">
        <div>
          <b>PDF 随机排序</b>
          <span>上传 PDF 后固定首页，从第 2 页开始随机打乱；建议勾选页码后查看效果。</span>
        </div>
        <el-tag type="danger" effect="plain">首页固定</el-tag>
      </div>

      <div class="pdf-shuffle-tools">
        <el-upload
          accept=".pdf,application/pdf"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onPdfShufflePick"
        >
          <el-button class="pink-outline" :loading="pdfShuffleProcessing">选择 PDF 文件</el-button>
        </el-upload>
        <el-checkbox v-model="pdfShuffleAddPageNumbers" :disabled="pdfShuffleProcessing" @change="refreshPdfShufflePreview">添加原始页码</el-checkbox>
        <el-button class="pink-outline" :disabled="!pdfShuffleFile || pdfShuffleProcessing" @click="randomizePdfShuffleOrder(true)">
          重新随机
        </el-button>
        <el-button class="pink-button" :loading="pdfShuffleProcessing" :disabled="!pdfShuffleFile || !pdfShuffleOrder.length" @click="downloadPdfShuffle">
          下载随机排序 PDF
        </el-button>
        <el-button class="soft-button" :disabled="!pdfShuffleFile || pdfShuffleProcessing" @click="clearPdfShuffle">清空 PDF</el-button>
      </div>

      <div v-if="pdfShuffleFile" class="word-split-summary">
        <span>PDF：<b>{{ pdfShuffleFile.name }}</b></span>
        <span>总页数 <b>{{ formatNumber(pdfShufflePageCount) }}</b> 页</span>
        <span>当前顺序 <b>{{ formatNumber(pdfShuffleOrder.length) }}</b> 页</span>
      </div>

      <el-progress v-if="pdfShuffleProcessing" :percentage="pdfShuffleProgress" />

      <div v-if="pdfShufflePreviewUrl" class="pdf-shuffle-preview">
        <div class="pdf-shuffle-preview-head">
          <b>随机后预览</b>
          <span>首页保持原第 1 页，后续页面已按当前随机顺序生成。</span>
        </div>
        <iframe :src="pdfShufflePreviewUrl" title="PDF 随机排序预览"></iframe>
      </div>

      <div v-if="pdfShuffleOrder.length" class="pdf-shuffle-list">
        <div v-for="(pageNumber, index) in pdfShuffleOrder" :key="`${index}-${pageNumber}`" class="pdf-shuffle-item">
          <b>新第 {{ index + 1 }} 页</b>
          <span>{{ index === 0 ? "首页固定" : `原第 ${pageNumber} 页` }}</span>
        </div>
      </div>
      <div v-else class="word-split-empty">上传 PDF 后，这里会显示首页固定、后续随机的页面顺序。</div>
    </section>
  </el-dialog>

  <el-dialog v-model="dialogVisible.pdfWatermark" title="💧 PDF 添加水印工具" width="900px" class="source-dialog pdf-watermark-dialog">
    <section class="pdf-shuffle-panel pdf-watermark-panel">
      <div class="word-split-head">
        <div>
          <b>PDF 添加水印</b>
          <span>可直接使用当前随机排序预览，也可以单独选择 PDF；支持中文文字、斜向平铺和居中水印。</span>
        </div>
        <el-tag type="warning" effect="plain">本地处理</el-tag>
      </div>

      <div class="pdf-shuffle-tools">
        <el-upload
          ref="pdfWatermarkUpload"
          accept=".pdf,application/pdf"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onPdfWatermarkPick"
        >
          <el-button class="pink-outline" :loading="pdfWatermarkProcessing">选择 PDF 文件</el-button>
        </el-upload>
        <el-button
          class="soft-button"
          :disabled="(!pdfShufflePreviewBlob && !pdfShuffleArrayBuffer) || pdfWatermarkProcessing"
          @click="usePdfShuffleForWatermark(true)"
        >
          使用随机排序 PDF
        </el-button>
        <el-button class="pink-outline" :loading="pdfWatermarkProcessing" :disabled="!pdfWatermarkArrayBuffer" @click="refreshPdfWatermarkPreview">
          刷新预览
        </el-button>
        <el-button class="pink-button" :loading="pdfWatermarkProcessing" :disabled="!pdfWatermarkArrayBuffer" @click="downloadPdfWatermark">
          下载水印 PDF
        </el-button>
        <el-button class="soft-button" :disabled="!pdfWatermarkArrayBuffer || pdfWatermarkProcessing" @click="clearPdfWatermark">清空 PDF</el-button>
      </div>

      <div class="pdf-watermark-settings">
        <el-form-item label="水印类型">
          <el-radio-group v-model="pdfWatermarkForm.kind">
            <el-radio-button label="text">文字</el-radio-button>
            <el-radio-button label="image">图片</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="pdfWatermarkForm.kind === 'text'" label="水印文字">
          <el-input v-model="pdfWatermarkForm.text" maxlength="80" show-word-limit placeholder="例如：仅供学习使用" />
        </el-form-item>
        <el-form-item v-else label="水印图片">
          <div class="watermark-upload-inline">
            <el-upload
              ref="pdfWatermarkImageUpload"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              :auto-upload="false"
              :show-file-list="false"
              :on-change="onPdfWatermarkImagePick"
            >
              <el-button class="pink-outline">上传水印图片</el-button>
            </el-upload>
            <span v-if="pdfWatermarkImageFileName" class="muted watermark-file-name">{{ pdfWatermarkImageFileName }}</span>
          </div>
        </el-form-item>
        <el-form-item label="水印样式">
          <el-select v-model="pdfWatermarkForm.mode">
            <el-option label="斜向平铺" value="tile" />
            <el-option label="居中单个" value="center" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="pdfWatermarkForm.kind === 'text'" label="字号">
          <el-input-number v-model="pdfWatermarkForm.fontSize" :min="16" :max="120" :step="2" />
        </el-form-item>
        <el-form-item v-else label="图片大小">
          <el-slider v-model="pdfWatermarkForm.imageScale" :min="6" :max="45" :format-tooltip="formatPercent" />
        </el-form-item>
        <el-form-item label="透明度">
          <el-slider v-model="pdfWatermarkForm.opacity" :min="5" :max="80" :format-tooltip="formatPercent" />
        </el-form-item>
        <el-form-item label="角度">
          <el-input-number v-model="pdfWatermarkForm.rotation" :min="-90" :max="90" :step="5" />
        </el-form-item>
        <el-form-item v-if="pdfWatermarkForm.kind === 'text'" label="颜色">
          <input v-model="pdfWatermarkForm.color" class="pdf-watermark-color" type="color" />
        </el-form-item>
      </div>

      <div v-if="pdfWatermarkArrayBuffer" class="word-split-summary pdf-watermark-summary">
        <span>PDF：<b>{{ pdfWatermarkFileName }}</b></span>
        <span>总页数 <b>{{ formatNumber(pdfWatermarkPageCount) }}</b> 页</span>
        <span>水印：<b>{{ pdfWatermarkForm.kind === "image" ? "图片水印" : "文字水印" }}</b></span>
      </div>

      <el-progress v-if="pdfWatermarkProcessing" :percentage="pdfWatermarkProgress" />

      <div v-if="pdfWatermarkPreviewUrl" class="pdf-shuffle-preview">
        <div class="pdf-shuffle-preview-head">
          <b>水印预览</b>
          <span>修改文字、透明度或样式后，点击刷新预览即可查看最新效果。</span>
        </div>
        <iframe :src="pdfWatermarkPreviewUrl" title="PDF 水印预览"></iframe>
      </div>

      <div v-else class="word-split-empty">选择 PDF 或使用当前随机排序 PDF 后，这里会显示水印预览。</div>
    </section>
  </el-dialog>
  <el-dialog v-model="dialogVisible.imageWatermark" title="🖼️ 图片添加水印工具" width="920px" class="source-dialog image-watermark-dialog">
    <section class="pdf-shuffle-panel image-watermark-panel">
      <div class="word-split-head">
        <div>
          <b>图片添加水印</b>
          <span>上传图片后在角落添加轻量水印，默认低透明度和小字号，尽量不影响原图观感。</span>
        </div>
        <el-tag type="success" effect="plain">本地处理</el-tag>
      </div>

      <el-upload
        class="upload-box document-image-uploader"
        drag
        multiple
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        :auto-upload="false"
        :show-file-list="false"
        :on-change="onImageWatermarkPick"
      >
        <div class="upload-emoji">🖼️</div>
        <div class="upload-text">拖拽图片到这里，或点击选择图片</div>
        <div class="upload-hint">支持 jpg / jpeg / png / webp，可一次处理多张</div>
      </el-upload>

      <div class="pdf-watermark-settings image-watermark-settings">
        <el-form-item label="水印文字">
          <el-input v-model="imageWatermarkForm.text" maxlength="60" show-word-limit placeholder="例如：仅供学习使用" />
        </el-form-item>
        <el-form-item label="位置">
          <el-select v-model="imageWatermarkForm.position">
            <el-option label="右下角" value="bottom-right" />
            <el-option label="左下角" value="bottom-left" />
            <el-option label="右上角" value="top-right" />
            <el-option label="居中" value="center" />
          </el-select>
        </el-form-item>
        <el-form-item label="字号">
          <el-input-number v-model="imageWatermarkForm.fontSize" :min="12" :max="80" :step="2" />
        </el-form-item>
        <el-form-item label="透明度">
          <el-slider v-model="imageWatermarkForm.opacity" :min="8" :max="45" :format-tooltip="formatPercent" />
        </el-form-item>
        <el-form-item label="颜色">
          <input v-model="imageWatermarkForm.color" class="pdf-watermark-color" type="color" />
        </el-form-item>
        <el-form-item label="柔和描边">
          <el-checkbox v-model="imageWatermarkForm.shadow">增强浅色/深色背景可读性</el-checkbox>
        </el-form-item>
      </div>

      <div class="pdf-shuffle-tools">
        <el-button class="pink-outline" :loading="imageWatermarkProcessing" :disabled="!imageWatermarkFiles.length" @click="refreshImageWatermarkPreview">
          刷新预览
        </el-button>
        <el-button class="pink-button" :loading="imageWatermarkProcessing" :disabled="!imageWatermarkItems.length" @click="downloadImageWatermarks">
          下载水印图片
        </el-button>
        <el-button class="soft-button" :disabled="!imageWatermarkFiles.length || imageWatermarkProcessing" @click="clearImageWatermark">
          清空图片
        </el-button>
      </div>

      <div v-if="imageWatermarkFiles.length" class="word-split-summary pdf-watermark-summary">
        <span>图片：<b>{{ formatNumber(imageWatermarkFiles.length) }}</b> 张</span>
        <span>透明度 <b>{{ imageWatermarkForm.opacity }}%</b></span>
        <span>位置：<b>{{ imageWatermarkPositionLabel }}</b></span>
      </div>

      <el-progress v-if="imageWatermarkProcessing" :percentage="imageWatermarkProgress" />

      <div v-if="imageWatermarkItems.length" class="image-watermark-grid">
        <figure v-for="item in imageWatermarkItems" :key="item.id">
          <img :src="item.watermarkedUrl || item.sourceUrl" :alt="item.name" loading="lazy" />
          <figcaption>{{ item.name }}</figcaption>
        </figure>
      </div>
      <div v-else class="word-split-empty">上传图片后，这里会显示添加水印后的预览。</div>
    </section>
  </el-dialog>

  <el-dialog v-model="dialogVisible.markdownEditor" title="📝 Markdown 在线编辑器 Pro" width="1080px" class="source-dialog markdown-editor-dialog">
    <section class="markdown-editor-panel">
      <div class="word-split-head markdown-editor-head">
        <div>
          <b>Markdown 在线编辑器 Pro</b>
          <span>{{ markdownFileName }} · {{ markdownStats.lines }} 行 · {{ markdownStats.chars }} 字符 · {{ markdownStats.headings }} 个标题</span>
        </div>
        <el-tag type="success" effect="plain">本地编辑</el-tag>
      </div>

      <div class="markdown-editor-toolbar">
        <el-button-group>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('h1')">H1</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('h2')">H2</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('bold')">B</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('italic')">I</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('quote')">引用</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('list')">列表</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('code')">代码</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('link')">链接</el-button>
          <el-button class="pink-outline" @click="insertMarkdownSnippet('table')">表格</el-button>
        </el-button-group>
        <el-radio-group v-model="markdownViewMode" size="small">
          <el-radio-button label="edit">编辑</el-radio-button>
          <el-radio-button label="split">分栏</el-radio-button>
          <el-radio-button label="preview">预览</el-radio-button>
        </el-radio-group>
        <div class="markdown-editor-actions">
          <input ref="markdownFileInput" type="file" hidden accept=".md,.markdown,.txt,text/markdown,text/plain" @change="onMarkdownFileChange" />
          <el-button class="soft-button" @click="markdownFileInput?.click()">导入</el-button>
          <el-button class="soft-button" @click="loadMarkdownExample">范文</el-button>
          <el-button class="pink-outline" :disabled="!markdownContent.trim()" @click="copyMarkdown">复制 MD</el-button>
          <el-button class="pink-outline" :disabled="!markdownContent.trim()" @click="copyMarkdownHtml">复制 HTML</el-button>
          <el-button class="pink-button" :disabled="!markdownContent.trim()" @click="downloadMarkdown">下载</el-button>
          <el-button class="soft-button" :disabled="!markdownContent.trim()" @click="clearMarkdownEditor">清空</el-button>
        </div>
      </div>

      <div class="markdown-editor-workspace" :class="`is-${markdownViewMode}`">
        <div v-if="markdownViewMode !== 'preview'" class="markdown-editor-pane">
          <el-input
            v-model="markdownContent"
            type="textarea"
            resize="none"
            :rows="22"
            spellcheck="false"
            placeholder="在这里输入 Markdown 内容"
          />
        </div>
        <article v-if="markdownViewMode !== 'edit'" class="markdown-preview-pane" v-html="markdownPreviewHtml"></article>
      </div>
    </section>
  </el-dialog>

  <el-dialog v-model="dialogVisible.htmlEditor" title="🌐 HTML 在线编辑器" width="1180px" class="source-dialog html-editor-dialog" @opened="updateHtmlPreview">
    <section class="html-editor-panel">
      <div class="word-split-head html-editor-head">
        <div>
          <b>🌐 HTML 在线编辑器</b>
          <span>HTML / CSS / JavaScript</span>
        </div>
        <el-tag type="success" effect="plain">本地编辑</el-tag>
      </div>

      <div class="html-editor-workspace">
        <div class="html-code-panel">
          <div class="html-panel-title">
            <span>🧩 HTML 代码</span>
            <span class="muted">{{ htmlEditorContent.length }} 字符</span>
          </div>
          <textarea
            v-model="htmlEditorContent"
            class="html-code-textarea"
            spellcheck="false"
            placeholder="请输入 HTML 代码..."
            @input="scheduleHtmlPreview"
            @keydown="handleHtmlEditorKeydown"
          ></textarea>
        </div>

        <div class="html-preview-panel">
          <div class="html-panel-title">
            <span>👀 实时预览</span>
            <div class="html-zoom-controls">
              <el-button class="pink-outline" size="small" @click="zoomOutHtmlPreview">-</el-button>
              <span>{{ htmlPreviewZoomLabel }}</span>
              <el-button class="pink-outline" size="small" @click="zoomInHtmlPreview">+</el-button>
              <el-button class="pink-outline" size="small" @click="fitHtmlPreviewToWindow">适应</el-button>
              <el-button class="pink-outline" size="small" @click="resetHtmlPreviewZoom">重置</el-button>
            </div>
          </div>
          <div ref="htmlPreviewContainer" class="html-preview-container">
            <iframe
              ref="htmlPreviewFrame"
              :key="htmlPreviewKey"
              class="html-preview-iframe"
              title="HTML 实时预览"
              sandbox="allow-scripts allow-forms allow-popups allow-modals"
              :srcdoc="htmlPreviewSource"
              :style="htmlPreviewStyle"
            ></iframe>
          </div>
        </div>
      </div>

      <div class="html-editor-actions">
        <el-button class="pink-outline" @click="refreshHtmlPreview">🔄 刷新预览</el-button>
        <el-button class="pink-button" :disabled="!htmlEditorContent.trim()" @click="downloadHtmlFile">⬇️ 下载 HTML 文件</el-button>
        <el-button class="soft-button" @click="loadHtmlExample">✨ 示例</el-button>
        <el-button class="soft-button" :disabled="!htmlEditorContent.trim()" @click="clearHtmlEditor">🧹 清空编辑器</el-button>
      </div>
    </section>
  </el-dialog>
  <StoryboardDialog v-model="dialogVisible.storyboard" />
  <ImageStitchDialog v-model="dialogVisible.imageStitch" />
  <XhsParseDialog v-model="dialogVisible.xhsParse" />
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { useTaskStore } from "../stores/useTaskStore";
import { useConfigStore } from "../stores/useConfigStore";
import { convertDocumentToImages, convertImagesToPdf, convertImagesToPpt, convertPdfToWord } from "../api/convert";
import StoryboardDialog from "./StoryboardDialog.vue";
import DocumentPptDialog from "./DocumentPptDialog.vue";
import ImageStitchDialog from "./ImageStitchDialog.vue";
import XhsParseDialog from "./XhsParseDialog.vue";

const taskStore = useTaskStore();
const configStore = useConfigStore();
const { textImageForm: textForm } = storeToRefs(taskStore);
const dialogVisible = reactive({ image: false, text: false, documentImage: false, documentPpt: false, convert: false, wordSplit: false, pdfShuffle: false, pdfWatermark: false, imageWatermark: false, markdownEditor: false, htmlEditor: false, storyboard: false, imageStitch: false, xhsParse: false });
const folderName = ref("");
const picked = ref([]);
const folderInput = ref(null);
const extracting = ref(false);
const textDocumentUpload = ref(null);
const textReferenceUpload = ref(null);
const textReferenceImage = ref(null);
const textReferencePreview = ref(null);
const draggingDocument = ref(false);
const documentImageFile = ref(null);
const documentImageConverting = ref(false);
const documentImageAutoStart = ref(false);
const documentImageStatus = ref("");
const documentImageResult = ref({ pages: [], downloadUrl: "", originalFile: null });
const documentImageProgress = reactive({
  percent: 0,
  label: "等待上传文档",
  detail: "",
  status: undefined
});
const converting = ref(false);
const convertResult = ref({ pages: [], downloadUrl: "" });
const convertFileInput = ref(null);
const sourceFolderInput = ref(null);
const sourceFolderName = ref("");
const outputDirectoryHandle = ref(null);
const convertFiles = ref([]);
const convertJobs = ref([]);
const convertLogs = ref([]);
const convertCanceled = ref(false);
const activeAbortController = ref(null);
const pickedPreviews = ref([]);
let textDocumentPickTimer;
const textReferenceForm = reactive({
  size: "3:4",
  quality: "1k"
});
const textReferenceQualityOptions = computed(() => {
  const provider = configStore.config?.provider;
  const pricing = configStore.config?.providerPricing?.[provider];
  const tiers = [
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" }
  ];
  if (!pricing) return tiers;
  return tiers.map((tier) => ({
    ...tier,
    label: pricing[tier.value] ? `${tier.label}（¥${pricing[tier.value]}/张）` : tier.label
  }));
});
const convertSettings = reactive({
  resolution: "2k",
  imageFormat: "png",
  quality: 92,
  separateFolder: true,
  outputFolder: "",
  fileName: "图片合并"
});
const settingsKey = "aiTeachingConvertSettings";
const latestToolSettingsKey = "aiTeachingLatestToolSettingsV1";
let latestToolSettingsLoaded = false;
const documentExts = new Set(["pdf", "doc", "docx", "txt", "md"]);
const presentationExts = new Set(["ppt", "pptx"]);
const imageExts = new Set(["jpg", "jpeg", "png", "webp"]);
const fileNameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const convertSort = reactive({ key: "name", order: "asc" });
const convertSortLabels = {
  default: "默认",
  name: "文件名",
  created: "创建时间",
  modified: "修改时间",
  size: "大小",
  type: "类型"
};
const convertFileOriginalOrder = new WeakMap();
let convertFileOrderSeed = 0;
const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const wordDocumentPath = "word/document.xml";
const splitFile = ref(null);
const splitZip = shallowRef(null);
const splitOriginalXml = ref("");
const splitXmlDoc = shallowRef(null);
const splitBlocks = shallowRef([]);
const splitGroups = shallowRef([]);
const splitTotalChars = ref(0);
const splitChars = ref(5000);
const splitLongBlock = ref(false);
const splitProcessing = ref(false);
const pdfShuffleFile = ref(null);
const pdfShuffleArrayBuffer = shallowRef(null);
const pdfShufflePageCount = ref(0);
const pdfShuffleOrder = ref([]);
const pdfShuffleAddPageNumbers = ref(true);
const pdfShuffleProcessing = ref(false);
const pdfShuffleProgress = ref(0);
const pdfShufflePreviewBlob = shallowRef(null);
const pdfShufflePreviewUrl = ref("");
const pdfWatermarkUpload = ref(null);
const pdfWatermarkImageUpload = ref(null);
const pdfWatermarkFileName = ref("");
const pdfWatermarkArrayBuffer = shallowRef(null);
const pdfWatermarkPageCount = ref(0);
const pdfWatermarkProcessing = ref(false);
const pdfWatermarkProgress = ref(0);
const pdfWatermarkPreviewBlob = shallowRef(null);
const pdfWatermarkPreviewUrl = ref("");
const pdfWatermarkImageFileName = ref("");
const pdfWatermarkImageDataUrl = ref("");
const pdfWatermarkForm = reactive({
  kind: "text",
  text: "仅供学习使用",
  mode: "tile",
  fontSize: 42,
  imageScale: 18,
  opacity: 18,
  rotation: -35,
  color: "#ff4f93"
});
const imageWatermarkFiles = ref([]);
const imageWatermarkItems = ref([]);
const imageWatermarkProcessing = ref(false);
const imageWatermarkProgress = ref(0);
const imageWatermarkForm = reactive({
  text: "仅供学习使用",
  position: "bottom-right",
  fontSize: 24,
  opacity: 18,
  color: "#ffffff",
  shadow: true
});
const markdownFileInput = ref(null);
const markdownFileName = ref("未命名文档.md");
const markdownViewMode = ref("split");
const markdownContent = ref(`# Markdown 在线编辑器 Pro

## 今日教辅笔记

- 适合整理知识点、题目讲解和小红书图文文案
- 左侧编辑，右侧实时预览
- 支持标题、列表、引用、代码块、表格和链接

> 把零散内容先写清楚，再交给 AI 生图会更稳。

| 模块 | 内容 |
| --- | --- |
| 目标 | 快速整理教辅发布稿 |
| 输出 | Markdown / HTML |
`);
const defaultHtmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>我的 HTML 页面</title>
  <style>
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      font-family: "Microsoft YaHei", Arial, sans-serif;
      color: #fff;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    main {
      width: min(680px, calc(100% - 40px));
      padding: 36px;
      border-radius: 18px;
      background: rgba(0, 0, 0, 0.24);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
      backdrop-filter: blur(14px);
    }

    h1 {
      margin: 0 0 12px;
      font-size: 40px;
    }

    p {
      margin: 0;
      line-height: 1.8;
    }
  </style>
</head>
<body>
  <main>
    <h1>🌐 欢迎使用 HTML 编辑器</h1>
    <p>在左侧修改 HTML、CSS 或脚本，右侧会实时刷新预览。你也可以使用 Ctrl + S 刷新预览，Ctrl + D 下载 HTML 文件。</p>
  </main>
</body>
</html>`;
const htmlEditorContent = ref(defaultHtmlContent);
const htmlPreviewSource = ref(defaultHtmlContent);
const htmlPreviewKey = ref(0);
const htmlPreviewZoom = ref(1);
const htmlPreviewContainer = ref(null);
const htmlPreviewFrame = ref(null);
let htmlPreviewTimer;

const convertSummary = computed(() => {
  if (!convertFiles.value.length) return "";
  const docCount = documentFiles.value.length;
  const presentationCount = presentationFiles.value.length;
  const imageCount = imageFiles.value.length;
  return `${convertFiles.value.length} 个文件（文档 ${docCount}，PPT ${presentationCount}，图片 ${imageCount}）`;
});

const documentFiles = computed(() => convertFiles.value.filter((file) => documentExts.has(fileExt(file))));
const presentationFiles = computed(() => convertFiles.value.filter((file) => presentationExts.has(fileExt(file))));
const imageFiles = computed(() => convertFiles.value.filter((file) => imageExts.has(fileExt(file))));
const pdfFiles = computed(() => convertFiles.value.filter((file) => fileExt(file) === "pdf"));
const convertedPreviewLimit = 60;
const visibleConvertedPages = computed(() => convertResult.value.pages.slice(0, convertedPreviewLimit));
const imageWatermarkPositionLabel = computed(() => (({
  "bottom-right": "右下角",
  "bottom-left": "左下角",
  "top-right": "右上角",
  center: "居中"
})[imageWatermarkForm.position] || "右下角"));
const hiddenConvertedPageCount = computed(() => Math.max(0, convertResult.value.pages.length - visibleConvertedPages.value.length));
const convertOrderPreviewLimit = 8;
const visibleConvertFileOrder = computed(() => convertFiles.value.slice(0, convertOrderPreviewLimit).map((file, index) => ({
  key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
  name: file.webkitRelativePath || file.name
})));
const hiddenConvertFileOrderCount = computed(() => Math.max(0, convertFiles.value.length - visibleConvertFileOrder.value.length));
const convertSortText = computed(() => {
  const label = convertSortLabels[convertSort.key] || "文件名";
  const orderText = convertSort.order === "desc" ? "递减" : "递增";
  return `${label} ${orderText}`;
});
const convertOverallProgress = computed(() => {
  if (!convertJobs.value.length) return 0;
  const total = convertJobs.value.reduce((sum, job) => sum + (Number(job.progress) || 0), 0);
  return Math.round(total / convertJobs.value.length);
});
const convertOverallStatus = computed(() => {
  if (!convertJobs.value.length) return undefined;
  if (convertJobs.value.some((job) => job.status === "error")) return "exception";
  if (convertJobs.value.every((job) => job.status === "success")) return "success";
  return undefined;
});
const convertProgressText = computed(() => {
  if (!convertJobs.value.length) return "";
  const done = convertJobs.value.filter((job) => job.status === "success").length;
  const failed = convertJobs.value.filter((job) => job.status === "error").length;
  const running = convertJobs.value.find((job) => job.status === "running");
  if (running) return `${done}/${convertJobs.value.length} 个文件完成，${running.message}`;
  if (failed) return `${done} 个完成，${failed} 个失败`;
  return `${done}/${convertJobs.value.length} 个文件完成`;
});
const markdownPreviewHtml = computed(() => renderMarkdown(markdownContent.value));
const markdownStats = computed(() => {
  const content = markdownContent.value || "";
  return {
    chars: content.length,
    headings: (content.match(/^#{1,6}\s+/gm) || []).length,
    lines: content ? content.split(/\r\n|\r|\n/).length : 0
  };
});
const htmlPreviewZoomLabel = computed(() => `${Math.round(htmlPreviewZoom.value * 100)}%`);
const htmlPreviewStyle = computed(() => ({
  transform: `scale(${htmlPreviewZoom.value})`,
  width: `${100 / htmlPreviewZoom.value}%`,
  height: `${100 / htmlPreviewZoom.value}%`
}));

onMounted(() => {
  loadLatestToolSettings();
  latestToolSettingsLoaded = true;
});

watch(
  [convertSettings, textReferenceForm, pdfWatermarkForm, imageWatermarkForm, pdfShuffleAddPageNumbers, markdownViewMode],
  () => {
    if (latestToolSettingsLoaded) persistLatestToolSettings();
  },
  { deep: true }
);

onUnmounted(() => {
  window.clearTimeout(htmlPreviewTimer);
  revokePdfShufflePreview();
  revokePdfWatermarkPreview();
  revokeImageWatermarkItems();
  if (textReferencePreview.value?.url) URL.revokeObjectURL(textReferencePreview.value.url);
  pickedPreviews.value.forEach((item) => URL.revokeObjectURL(item.url));
});

function onPick(file, fileList) {
  picked.value = fileList.map((item) => item.raw).filter(Boolean);
  refreshPickedPreviews();
}

async function submitPicked() {
  if (!picked.value.length) return ElMessage.warning("请先选择图片");
  const ok = await taskStore.upload(picked.value, folderName.value);
  if (ok) closeImageDialog();
}

function refreshPickedPreviews() {
  pickedPreviews.value.forEach((item) => URL.revokeObjectURL(item.url));
  pickedPreviews.value = picked.value.slice(0, 24).map((file) => ({
    name: file.name,
    url: URL.createObjectURL(file)
  }));
}

function clearPicked() {
  picked.value = [];
  pickedPreviews.value.forEach((item) => URL.revokeObjectURL(item.url));
  pickedPreviews.value = [];
}

function resetImageDialog() {
  clearPicked();
  folderName.value = "";
}

function resetTextDialog() {
  textForm.value.title = "图文生成";
  textForm.value.sourceText = "";
  textForm.value.count = 1;
  textForm.value.documentName = "";
  textReferenceForm.size = "3:4";
  textReferenceForm.quality = "1k";
  clearReferenceImage();
}

function resetDocumentImageDialog() {
  documentImageFile.value = null;
  documentImageConverting.value = false;
  documentImageStatus.value = "";
  documentImageResult.value = { pages: [], downloadUrl: "", originalFile: null };
  resetDocumentImageProgress();
}

async function onFolderChange(event) {
  const files = [...event.target.files];
  const firstPath = files[0]?.webkitRelativePath || "";
  const folder = firstPath.split("/")[0] || folderName.value;
  folderName.value = folder;
  const ok = await taskStore.upload(files, folder);
  if (ok) closeImageDialog();
  event.target.value = "";
}

function closeImageDialog() {
  dialogVisible.image = false;
}

function onDocumentPick(file, fileList = []) {
  const files = (fileList.length ? fileList : [file]).map((item) => item.raw).filter(Boolean);
  window.clearTimeout(textDocumentPickTimer);
  textDocumentPickTimer = window.setTimeout(() => extractTextDocuments(files), 80);
}

async function extractTextDocuments(files) {
  const documentFiles = files.filter((item) => ["txt", "md", "docx", "pdf"].includes(fileExt(item)));
  if (!documentFiles.length) return ElMessage.warning("请上传 txt / md / docx / pdf 文档");
  extracting.value = true;
  try {
    await taskStore.extractDocument(documentFiles);
    textDocumentUpload.value?.clearFiles?.();
  } catch (error) {
    ElMessage.warning(error.response?.data?.message || "文档提取失败");
  } finally {
    extracting.value = false;
  }
}

function onTextDragEnter(event) {
  if (hasDocumentFile(event.dataTransfer?.items)) draggingDocument.value = true;
}

function onTextDragOver(event) {
  if (hasDocumentFile(event.dataTransfer?.items)) draggingDocument.value = true;
}

function onTextDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) draggingDocument.value = false;
}

async function onTextDocumentDrop(event) {
  draggingDocument.value = false;
  const files = [...(event.dataTransfer?.files || [])].filter((item) => ["txt", "md", "docx", "pdf"].includes(fileExt(item)));
  if (!files.length) return ElMessage.warning("请拖入 txt / md / docx / pdf 文档");
  await extractTextDocuments(files);
}

function onReferenceImagePick(file) {
  const raw = file?.raw;
  if (!raw) return;
  if (!imageExts.has(fileExt(raw))) {
    textReferenceUpload.value?.clearFiles?.();
    return ElMessage.warning("请上传 jpg / jpeg / png / webp 参考图");
  }
  clearReferenceImage(false);
  textReferenceImage.value = raw;
  textReferencePreview.value = {
    name: raw.name,
    url: URL.createObjectURL(raw)
  };
}

function clearReferenceImage(clearUpload = true) {
  if (textReferencePreview.value?.url) URL.revokeObjectURL(textReferencePreview.value.url);
  textReferencePreview.value = null;
  textReferenceImage.value = null;
  if (clearUpload) textReferenceUpload.value?.clearFiles?.();
}

async function submitTextTasks() {
  const ok = await taskStore.generateFromTextReference({
    referenceImage: textReferenceImage.value,
    size: textReferenceForm.size,
    quality: textReferenceForm.quality
  });
  if (ok) dialogVisible.text = false;
}

async function onDocumentImagePick(file) {
  const raw = file.raw;
  if (!raw) return;
  if (!["pdf", "docx", "txt", "md"].includes(fileExt(raw))) {
    ElMessage.warning("请上传 pdf / docx / txt / md 文档");
    return;
  }
  documentImageFile.value = raw;
  await runDocumentImageGeneration(raw);
}

async function runDocumentImageGeneration(file = documentImageFile.value) {
  if (!file) return ElMessage.warning("请先上传文档");
  if (documentImageConverting.value) return;

  documentImageConverting.value = true;
  documentImageResult.value = { pages: [], downloadUrl: "", originalFile: null };
  documentImageStatus.value = "正在把文档转成页面图片...";
  setDocumentImageProgress(8, "正在转换文档", "正在把 Word / PDF 转成页面图片");
  activeAbortController.value = new AbortController();

  try {
    const res = await convertDocumentToImages(file, {
      ...requestOptions(),
      skipBlankPages: true,
      signal: activeAbortController.value.signal
    });
    const pages = res.data.pages || [];
    const skippedCount = Number(res.data.skippedBlankPageCount || 0);
    const conversionSummary = skippedCount
      ? `已跳过 ${skippedCount} 张空白页，保留 ${pages.length} 张内容页`
      : `已转成 ${pages.length} 张页面图片`;
    setDocumentImageProgress(35, "文档转图完成", conversionSummary);
    documentImageResult.value = {
      pages,
      downloadUrl: res.data.downloadUrl || "",
      originalFile: res.data.originalFile || null
    };

    if (!pages.length) {
      documentImageStatus.value = `${conversionSummary}；没有可生成的内容，未创建新任务，原文档仍已保留`;
      setDocumentImageProgress(100, "没有可生成的内容", conversionSummary, "warning");
      ElMessage.info("文档页面均为空白，已跳过，未创建生图任务");
      return;
    }

    documentImageStatus.value = `${conversionSummary}，正在导入生图任务...`;
    const files = await convertedPagesToFiles(pages, file, (done, total) => {
      const percent = 35 + Math.round((done / Math.max(total, 1)) * 35);
      setDocumentImageProgress(percent, "正在读取页面图片", `${done} / ${total} 张`);
    });
    setDocumentImageProgress(75, "正在上传页面图片", `${files.length} 张图片正在创建任务`);
    const ok = await taskStore.upload(files, fileBaseName(file.name), {
      maxBatchCount: files.length,
      onUploadProgress(progressEvent) {
        const total = progressEvent.total || 0;
        if (!total) return;
        const uploadPercent = Math.round((progressEvent.loaded / total) * 20);
        setDocumentImageProgress(75 + uploadPercent, "正在上传页面图片", `${Math.min(100, Math.round((progressEvent.loaded / total) * 100))}%`);
      }
    });
    if (!ok) {
      documentImageStatus.value = "页面图片导入失败，请重试";
      setDocumentImageProgress(100, "导入失败", "页面图片没有成功进入任务列表", "exception");
      return;
    }
    setDocumentImageProgress(96, "任务已创建", `已创建 ${files.length} 个任务`);

    if (documentImageAutoStart.value) {
      documentImageStatus.value = "任务已创建，正在开始 AI 教辅绘制...";
      await taskStore.generate();
      documentImageStatus.value = `${conversionSummary}，已开始绘制，原文档仍已保留`;
      setDocumentImageProgress(100, "已开始绘制", `${pages.length} 张图片已进入生成流程`, "success");
      return;
    }

    documentImageStatus.value = `${conversionSummary}，原文档仍已保留；可在底部点击 AI 教辅绘制开始生成`;
    setDocumentImageProgress(100, "已完成", `${files.length} 张页面图片已进入任务列表`, "success");
    ElMessage.success(`📄 已创建 ${files.length} 个文档生图任务${skippedCount ? `，跳过 ${skippedCount} 张空白页` : ""}`);
  } catch (error) {
    const canceled = error.code === "ERR_CANCELED";
    documentImageStatus.value = canceled ? "已取消文档生图" : "文档生图失败";
    setDocumentImageProgress(100, canceled ? "已取消" : "处理失败", error.response?.data?.message || error.message || "", canceled ? undefined : "exception");
    if (!canceled) ElMessage.warning(error.response?.data?.message || error.message || "文档生图失败");
  } finally {
    activeAbortController.value = null;
    documentImageConverting.value = false;
  }
}

function resetDocumentImageProgress() {
  setDocumentImageProgress(0, "等待上传文档", "", undefined);
}

function setDocumentImageProgress(percent, label, detail = "", status = undefined) {
  documentImageProgress.percent = Math.min(Math.max(Number(percent) || 0, 0), 100);
  documentImageProgress.label = label;
  documentImageProgress.detail = detail;
  documentImageProgress.status = status;
}

async function convertedPagesToFiles(pages, sourceFile, onProgress) {
  const files = [];
  const ext = imageExtension(convertSettings.imageFormat);
  for (const [index, page] of pages.entries()) {
    const response = await fetch(page.url);
    if (!response.ok) throw new Error(`读取第 ${page.index} 页图片失败`);
    const blob = await response.blob();
    files.push(new File([blob], `${fileBaseName(sourceFile.name)}-${page.index}.${ext}`, {
      type: blob.type || imageMime(convertSettings.imageFormat)
    }));
    onProgress?.(index + 1, pages.length);
  }
  return files;
}

function hasDocumentFile(items = []) {
  return [...items].some((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file && ["txt", "md", "docx", "pdf"].includes(fileExt(file));
  });
}

function fileExt(file) {
  return String(file?.name || "").split(".").pop()?.toLowerCase() || "";
}

function imageExtension(format) {
  return format === "jpeg" ? "jpg" : format;
}

function imageMime(format) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function convertFileSortKey(file) {
  return String(file?.webkitRelativePath || file?.name || "");
}

function markConvertFileOrder(files = []) {
  for (const file of files) {
    if (!convertFileOriginalOrder.has(file)) {
      convertFileOriginalOrder.set(file, convertFileOrderSeed);
      convertFileOrderSeed += 1;
    }
  }
}

function getConvertFileSortValue(file, key = convertSort.key) {
  if (key === "default") return convertFileOriginalOrder.get(file) ?? 0;
  if (key === "size") return Number(file?.size) || 0;
  if (key === "created" || key === "modified") return Number(file?.lastModified) || 0;
  if (key === "type") return fileExt(file) || String(file?.type || "");
  return convertFileSortKey(file);
}

function compareConvertFiles(a, b) {
  const key = convertSort.key;
  const aValue = getConvertFileSortValue(a, key);
  const bValue = getConvertFileSortValue(b, key);
  let result = 0;
  if (typeof aValue === "number" && typeof bValue === "number") {
    result = aValue - bValue;
  } else {
    result = fileNameCollator.compare(String(aValue), String(bValue));
  }
  if (!result && key !== "name") {
    result = fileNameCollator.compare(convertFileSortKey(a), convertFileSortKey(b));
  }
  return convertSort.order === "desc" ? -result : result;
}

function sortFilesByNaturalName(files = []) {
  return [...files].sort(compareConvertFiles);
}

function sortConvertFiles(silent = false) {
  if (convertFiles.value.length < 2) return;
  convertFiles.value = sortFilesByNaturalName(convertFiles.value);
  convertResult.value = { pages: [], downloadUrl: "" };
  convertJobs.value = [];
  if (!silent) {
    const label = convertSortLabels[convertSort.key] || "文件名";
    const orderText = convertSort.order === "desc" ? "递减" : "递增";
    addConvertLog("success", `已按${label}${orderText}排序`);
    ElMessage.success(`已按${label}${orderText}排序`);
  }
}

function handleConvertSortCommand(command) {
  const [type, value] = String(command).split(":");
  if (type === "key" && value) convertSort.key = value;
  if (type === "order" && value) convertSort.order = value;
  sortConvertFiles();
}
function onConvertFilesChange(event) {
  setConvertFiles([...event.target.files], "");
  event.target.value = "";
}

function onSourceFolderChange(event) {
  const files = [...event.target.files];
  const firstPath = files[0]?.webkitRelativePath || "";
  const folder = firstPath.split("/")[0] || "";
  setConvertFiles(files, folder);
  event.target.value = "";
}

function setConvertFiles(files, folderName = "") {
  const filteredFiles = files.filter((file) => documentExts.has(fileExt(file)) || presentationExts.has(fileExt(file)) || imageExts.has(fileExt(file)));
  markConvertFileOrder(filteredFiles);
  convertFiles.value = sortFilesByNaturalName(filteredFiles);
  sourceFolderName.value = folderName;
  convertResult.value = { pages: [], downloadUrl: "" };
  convertJobs.value = [];
  convertLogs.value = [];
  if (!convertFiles.value.length) {
    ElMessage.warning("没有找到可处理的 Word / PDF / PPT / 图片文件");
    return;
  }
  addConvertLog("info", `已选择 ${convertFiles.value.length} 个文件`);
}

function clearConvertFiles() {
  convertFiles.value = [];
  sourceFolderName.value = "";
  convertJobs.value = [];
  convertLogs.value = [];
  convertResult.value = { pages: [], downloadUrl: "" };
}

async function onSplitDocumentPick(file) {
  const raw = file.raw;
  if (!raw) return;
  if (fileExt(raw) !== "docx") {
    ElMessage.warning("请上传 .docx 格式的 Word 文档");
    return;
  }

  splitProcessing.value = true;
  try {
    const parsed = await parseSplitDocx(raw);
    splitFile.value = raw;
    splitZip.value = parsed.zip;
    splitOriginalXml.value = parsed.xmlString;
    splitXmlDoc.value = parsed.xmlDoc;
    splitBlocks.value = getSplitContentBlocks(parsed.xmlDoc);
    splitTotalChars.value = splitBlocks.value.reduce((sum, block) => sum + block.length, 0);
    refreshSplitPreview();
    if (!splitTotalChars.value) {
      ElMessage.warning("未检测到正文文字，可能是图片型文档或特殊格式文档");
    } else {
      ElMessage.success("Word 文档读取成功");
    }
  } catch (error) {
    clearSplitDocument();
    ElMessage.warning(error.message || "Word 文档读取失败");
  } finally {
    splitProcessing.value = false;
  }
}

async function parseSplitDocx(file) {
  const JSZip = await loadZipLibrary();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentFile = zip.file(wordDocumentPath);
  if (!documentFile) throw new Error("无法读取 Word 正文内容，请确认这是有效的 .docx 文件");

  const xmlString = await documentFile.async("string");
  const xmlDoc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (xmlDoc.getElementsByTagName("parsererror")[0]) {
    throw new Error("Word 正文结构解析失败");
  }

  return { zip, xmlString, xmlDoc };
}

function loadZipLibrary() {
  if (window.JSZip) return Promise.resolve(window.JSZip);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = () => resolve(window.JSZip);
    script.onerror = () => reject(new Error("拆分组件加载失败，请检查网络后重试"));
    document.head.appendChild(script);
  });
}

function loadPdfLibrary() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/pdf-lib/dist/pdf-lib.min.js";
    script.onload = () => resolve(window.PDFLib);
    script.onerror = () => reject(new Error("PDF 随机排序组件加载失败，请检查网络后重试"));
    document.head.appendChild(script);
  });
}

function getSplitContentBlocks(xmlDoc) {
  const body = getWordBody(xmlDoc);
  if (!body) return [];

  return Array.from(body.childNodes)
    .filter((node) => node.nodeType === Node.ELEMENT_NODE)
    .filter((node) => node.localName === "p" || node.localName === "tbl")
    .map((element) => {
      const text = getTextFromWordNode(element);
      return {
        element,
        type: element.localName === "tbl" ? "table" : "paragraph",
        text,
        length: text.length
      };
    });
}

function getTextFromWordNode(node) {
  let textNodes = Array.from(node.getElementsByTagNameNS(wordNamespace, "t"));
  if (!textNodes.length) {
    textNodes = [];
    walkWordNode(node, (child) => {
      if (child.nodeType === Node.ELEMENT_NODE && child.localName === "t") {
        textNodes.push(child);
      }
    });
  }
  return textNodes.map((textNode) => textNode.textContent || "").join("");
}

function walkWordNode(node, visitor) {
  visitor(node);
  Array.from(node.childNodes || []).forEach((child) => walkWordNode(child, visitor));
}

function refreshSplitPreview() {
  const chars = Math.max(100, Math.min(50000, Math.floor(Number(splitChars.value) || 5000)));
  splitChars.value = chars;
  const result = createSplitGroups(splitBlocks.value, chars);
  splitGroups.value = result.groups;
  splitLongBlock.value = result.hasLongBlock;
}

function createSplitGroups(contentBlocks, charsPerFile) {
  const groups = [];
  let currentGroup = [];
  let currentLength = 0;
  let hasLongBlock = false;

  for (const block of contentBlocks) {
    if (block.length > charsPerFile) hasLongBlock = true;
    if (currentGroup.length && currentLength + block.length > charsPerFile) {
      groups.push(createSplitGroupSummary(currentGroup));
      currentGroup = [];
      currentLength = 0;
    }
    currentGroup.push(block);
    currentLength += block.length;
  }

  if (currentGroup.length) groups.push(createSplitGroupSummary(currentGroup));
  return { groups, hasLongBlock };
}

function createSplitGroupSummary(blocks) {
  return {
    blocks,
    length: blocks.reduce((sum, block) => sum + block.length, 0),
    blockCount: blocks.length
  };
}

async function downloadSplitPackage() {
  if (!splitFile.value) return ElMessage.warning("请先选择 Word 文档");
  if (!splitGroups.value.length) return ElMessage.warning("没有可拆分的正文内容");
  if (splitProcessing.value) return;

  splitProcessing.value = true;
  try {
    const JSZip = await loadZipLibrary();
    const packageZip = new JSZip();
    const baseName = safeOutputFileName(fileBaseName(splitFile.value.name));

    for (let index = 0; index < splitGroups.value.length; index += 1) {
      const docxBlob = await createDocxFromSplitGroup(splitGroups.value[index], JSZip);
      packageZip.file(`${baseName}_第${index + 1}部分.docx`, docxBlob);
      await nextFrame();
    }

    const zipBlob = await packageZip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 }
    });
    saveBlob(zipBlob, `${baseName}_拆分文件.zip`);
    ElMessage.success("Word 文档拆分完成");
  } catch (error) {
    ElMessage.warning(error.message || "Word 文档拆分失败");
  } finally {
    splitProcessing.value = false;
  }
}

async function createDocxFromSplitGroup(group, JSZip) {
  const newZip = new JSZip();
  await copySplitZipFiles(splitZip.value, newZip);

  const newXmlDoc = new DOMParser().parseFromString(splitOriginalXml.value, "application/xml");
  const newBody = getWordBody(newXmlDoc);
  const originalBody = getWordBody(splitXmlDoc.value);
  if (!newBody || !originalBody) throw new Error("Word 正文结构不完整");

  const originalSectPr = Array.from(originalBody.childNodes)
    .find((node) => node.nodeType === Node.ELEMENT_NODE && node.localName === "sectPr");

  while (newBody.firstChild) {
    newBody.removeChild(newBody.firstChild);
  }

  group.blocks.forEach((block) => {
    newBody.appendChild(newXmlDoc.importNode(block.element, true));
  });

  if (originalSectPr) {
    newBody.appendChild(newXmlDoc.importNode(originalSectPr, true));
  }

  newZip.file(wordDocumentPath, new XMLSerializer().serializeToString(newXmlDoc));
  return newZip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
}

async function copySplitZipFiles(sourceZip, targetZip) {
  const copyTasks = [];
  sourceZip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir || relativePath === wordDocumentPath) return;
    copyTasks.push(
      zipEntry.async("arraybuffer").then((content) => {
        targetZip.file(relativePath, content, {
          date: zipEntry.date,
          compression: "DEFLATE"
        });
      })
    );
  });
  await Promise.all(copyTasks);
}

function getWordBody(xmlDoc) {
  return Array.from(xmlDoc?.getElementsByTagNameNS(wordNamespace, "body") || [])[0]
    || Array.from(xmlDoc?.getElementsByTagName("w:body") || [])[0]
    || null;
}

function clearSplitDocument() {
  splitFile.value = null;
  splitZip.value = null;
  splitOriginalXml.value = "";
  splitXmlDoc.value = null;
  splitBlocks.value = [];
  splitGroups.value = [];
  splitTotalChars.value = 0;
  splitLongBlock.value = false;
  splitProcessing.value = false;
}

async function onPdfShufflePick(file) {
  const raw = file.raw;
  if (!raw) return;
  if (fileExt(raw) !== "pdf") {
    ElMessage.warning("请上传 .pdf 格式文件");
    return;
  }

  pdfShuffleProcessing.value = true;
  pdfShuffleProgress.value = 12;
  try {
    const PDFLib = await loadPdfLibrary();
    const arrayBuffer = await raw.arrayBuffer();
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
    const pageCount = pdfDoc.getPageCount();
    if (!pageCount) throw new Error("未检测到 PDF 页面");

    pdfShuffleFile.value = raw;
    pdfShuffleArrayBuffer.value = arrayBuffer;
    pdfShufflePageCount.value = pageCount;
    randomizePdfShuffleOrder(false);
    await rebuildPdfShufflePreview(PDFLib);
    pdfShuffleProgress.value = 100;
    ElMessage.success("PDF 读取成功，已生成随机预览");
  } catch (error) {
    clearPdfShuffle();
    ElMessage.warning(error.message || "PDF 读取失败，请确认文件未损坏或加密");
  } finally {
    pdfShuffleProcessing.value = false;
  }
}

async function randomizePdfShuffleOrder(showMessage) {
  if (!pdfShufflePageCount.value) {
    ElMessage.warning("请先选择 PDF 文件");
    return;
  }

  const fixedFirstPage = 1;
  const shuffledPages = Array.from({ length: Math.max(0, pdfShufflePageCount.value - 1) }, (_, index) => index + 2);

  for (let index = shuffledPages.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffledPages[index], shuffledPages[randomIndex]] = [shuffledPages[randomIndex], shuffledPages[index]];
  }

  if (shuffledPages.length > 1 && shuffledPages.every((pageNumber, index) => pageNumber === index + 2)) {
    [shuffledPages[0], shuffledPages[1]] = [shuffledPages[1], shuffledPages[0]];
  }

  pdfShuffleOrder.value = [fixedFirstPage, ...shuffledPages];
  if (showMessage) {
    pdfShuffleProcessing.value = true;
    pdfShuffleProgress.value = 18;
    try {
      const PDFLib = await loadPdfLibrary();
      await rebuildPdfShufflePreview(PDFLib);
      ElMessage.success("已重新生成随机预览");
    } catch (error) {
      ElMessage.warning(error.message || "随机预览生成失败");
    } finally {
      pdfShuffleProcessing.value = false;
    }
  }
}

async function downloadPdfShuffle() {
  if (!pdfShuffleFile.value || !pdfShuffleArrayBuffer.value) return ElMessage.warning("请先选择 PDF 文件");
  if (!pdfShuffleOrder.value.length) return ElMessage.warning("请先生成随机顺序");
  if (pdfShuffleProcessing.value) return;

  pdfShuffleProcessing.value = true;
  pdfShuffleProgress.value = 8;
  try {
    const PDFLib = await loadPdfLibrary();
    const blob = pdfShufflePreviewBlob.value || await createPdfShuffleBlob(PDFLib);
    saveBlob(blob, `${safeOutputFileName(fileBaseName(pdfShuffleFile.value.name))}_随机排序.pdf`);
    pdfShuffleProgress.value = 100;
    ElMessage.success("PDF 随机排序完成");
  } catch (error) {
    ElMessage.warning(error.message || "PDF 随机排序失败，可能是文件加密或浏览器内存不足");
  } finally {
    pdfShuffleProcessing.value = false;
  }
}

async function refreshPdfShufflePreview() {
  if (!pdfShuffleFile.value || !pdfShuffleOrder.value.length || pdfShuffleProcessing.value) return;

  pdfShuffleProcessing.value = true;
  pdfShuffleProgress.value = 18;
  try {
    const PDFLib = await loadPdfLibrary();
    await rebuildPdfShufflePreview(PDFLib);
    ElMessage.success("预览已更新");
  } catch (error) {
    ElMessage.warning(error.message || "预览更新失败");
  } finally {
    pdfShuffleProcessing.value = false;
  }
}

async function rebuildPdfShufflePreview(PDFLib) {
  const blob = await createPdfShuffleBlob(PDFLib);
  revokePdfShufflePreview();
  pdfShufflePreviewBlob.value = blob;
  pdfShufflePreviewUrl.value = URL.createObjectURL(blob);
}

async function createPdfShuffleBlob(PDFLib) {
  const sourceDoc = await PDFLib.PDFDocument.load(pdfShuffleArrayBuffer.value);
  pdfShuffleProgress.value = Math.max(pdfShuffleProgress.value, 34);

  if (pdfShuffleAddPageNumbers.value) {
    await addOriginalPageNumbers(sourceDoc, PDFLib);
  }

  const outputDoc = await PDFLib.PDFDocument.create();
  const copiedPages = await outputDoc.copyPages(
    sourceDoc,
    pdfShuffleOrder.value.map((pageNumber) => pageNumber - 1)
  );
  copiedPages.forEach((page) => outputDoc.addPage(page));
  pdfShuffleProgress.value = Math.max(pdfShuffleProgress.value, 78);

  const pdfBytes = await outputDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function addOriginalPageNumbers(pdfDoc, PDFLib) {
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const fontSize = 11;

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const label = `Page ${index + 1}`;
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    page.drawText(label, {
      x: Math.max(18, width - textWidth - 24),
      y: 18,
      size: fontSize,
      font,
      color: PDFLib.rgb(0.42, 0.42, 0.42),
      opacity: 0.78
    });
  });
}

function clearPdfShuffle() {
  revokePdfShufflePreview();
  pdfShuffleFile.value = null;
  pdfShuffleArrayBuffer.value = null;
  pdfShufflePageCount.value = 0;
  pdfShuffleOrder.value = [];
  pdfShuffleAddPageNumbers.value = true;
  pdfShuffleProcessing.value = false;
  pdfShuffleProgress.value = 0;
}

function revokePdfShufflePreview() {
  if (pdfShufflePreviewUrl.value) {
    URL.revokeObjectURL(pdfShufflePreviewUrl.value);
  }
  pdfShufflePreviewUrl.value = "";
  pdfShufflePreviewBlob.value = null;
}

async function openPdfWatermarkDialog() {
  dialogVisible.pdfWatermark = true;
  if (!pdfWatermarkArrayBuffer.value && (pdfShufflePreviewBlob.value || pdfShuffleArrayBuffer.value)) {
    await usePdfShuffleForWatermark(false);
  }
}

async function onPdfWatermarkPick(file) {
  const raw = file.raw;
  if (!raw) return;
  if (fileExt(raw) !== "pdf") {
    ElMessage.warning("请上传 .pdf 格式文件");
    return;
  }

  await setPdfWatermarkSource(await raw.arrayBuffer(), raw.name, "PDF 读取成功，已生成水印预览");
}

async function usePdfShuffleForWatermark(showMessage = true) {
  if (!pdfShufflePreviewBlob.value && !pdfShuffleArrayBuffer.value) {
    ElMessage.warning("请先选择或生成随机排序 PDF");
    return;
  }

  const fileName = `${fileBaseName(pdfShuffleFile.value?.name || "随机排序PDF")}_随机排序.pdf`;
  const arrayBuffer = pdfShufflePreviewBlob.value
    ? await pdfShufflePreviewBlob.value.arrayBuffer()
    : pdfShuffleArrayBuffer.value.slice(0);
  await setPdfWatermarkSource(arrayBuffer, fileName, showMessage ? "已载入当前随机排序 PDF" : "");
}

async function setPdfWatermarkSource(arrayBuffer, fileName, successMessage = "") {
  pdfWatermarkProcessing.value = true;
  pdfWatermarkProgress.value = 10;
  try {
    const PDFLib = await loadPdfLibrary();
    const sourceBuffer = arrayBuffer.slice(0);
    const pdfDoc = await PDFLib.PDFDocument.load(sourceBuffer);
    const pageCount = pdfDoc.getPageCount();
    if (!pageCount) throw new Error("未检测到 PDF 页面");

    revokePdfWatermarkPreview();
    pdfWatermarkArrayBuffer.value = sourceBuffer;
    pdfWatermarkFileName.value = fileName || "document.pdf";
    pdfWatermarkPageCount.value = pageCount;
    await rebuildPdfWatermarkPreview(PDFLib);
    pdfWatermarkProgress.value = 100;
    if (successMessage) ElMessage.success(successMessage);
  } catch (error) {
    clearPdfWatermark();
    ElMessage.warning(error.message || "PDF 读取失败，请确认文件未损坏或加密");
  } finally {
    pdfWatermarkProcessing.value = false;
  }
}

async function refreshPdfWatermarkPreview() {
  if (!pdfWatermarkArrayBuffer.value || pdfWatermarkProcessing.value) return;

  pdfWatermarkProcessing.value = true;
  pdfWatermarkProgress.value = 16;
  try {
    const PDFLib = await loadPdfLibrary();
    await rebuildPdfWatermarkPreview(PDFLib);
    pdfWatermarkProgress.value = 100;
    ElMessage.success("水印预览已更新");
  } catch (error) {
    ElMessage.warning(error.message || "水印预览生成失败");
  } finally {
    pdfWatermarkProcessing.value = false;
  }
}

async function downloadPdfWatermark() {
  if (!pdfWatermarkArrayBuffer.value) return ElMessage.warning("请先选择 PDF 文件");
  if (pdfWatermarkProcessing.value) return;

  pdfWatermarkProcessing.value = true;
  pdfWatermarkProgress.value = 12;
  try {
    const PDFLib = await loadPdfLibrary();
    const blob = await createPdfWatermarkBlob(PDFLib);
    saveBlob(blob, `${safeOutputFileName(fileBaseName(pdfWatermarkFileName.value))}_水印.pdf`);
    pdfWatermarkProgress.value = 100;
    ElMessage.success("PDF 水印添加完成");
  } catch (error) {
    ElMessage.warning(error.message || "PDF 水印添加失败，可能是文件加密或浏览器内存不足");
  } finally {
    pdfWatermarkProcessing.value = false;
  }
}

async function rebuildPdfWatermarkPreview(PDFLib) {
  const blob = await createPdfWatermarkBlob(PDFLib);
  revokePdfWatermarkPreview();
  pdfWatermarkPreviewBlob.value = blob;
  pdfWatermarkPreviewUrl.value = URL.createObjectURL(blob);
}

async function createPdfWatermarkBlob(PDFLib) {
  const pdfDoc = await PDFLib.PDFDocument.load(pdfWatermarkArrayBuffer.value);
  pdfWatermarkProgress.value = Math.max(pdfWatermarkProgress.value, 34);
  const watermark = await createPdfWatermarkImage(pdfDoc);

  pdfDoc.getPages().forEach((page) => {
    drawWatermarkOnPage(page, watermark, PDFLib);
  });

  pdfWatermarkProgress.value = Math.max(pdfWatermarkProgress.value, 78);
  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function onPdfWatermarkImagePick(file) {
  const raw = file.raw;
  if (!raw) return;
  if (!imageExts.has(fileExt(raw))) {
    ElMessage.warning("请上传 png / jpg / webp 图片");
    return;
  }

  pdfWatermarkImageFileName.value = raw.name;
  pdfWatermarkImageDataUrl.value = await fileToDataUrl(raw);
  if (pdfWatermarkArrayBuffer.value) await refreshPdfWatermarkPreview();
}

async function createPdfWatermarkImage(pdfDoc) {
  if (pdfWatermarkForm.kind === "image") {
    if (!pdfWatermarkImageDataUrl.value) throw new Error("请先上传水印图片");
    const imageInfo = await loadImageInfo(pdfWatermarkImageDataUrl.value);
    const image = await pdfDoc.embedPng(dataUrlToUint8Array(imageInfo.dataUrl));
    return { image, width: imageInfo.width, height: imageInfo.height, kind: "image" };
  }

  const text = (pdfWatermarkForm.text || "").trim() || "Watermark";
  const fontSize = clampNumber(pdfWatermarkForm.fontSize, 16, 120, 42);
  const pixelRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 2));
  const fontFamily = "\"Microsoft YaHei\", \"PingFang SC\", Arial, sans-serif";
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `700 ${fontSize}px ${fontFamily}`;
  const measuredWidth = probe.measureText(text).width;
  const width = Math.ceil(Math.min(Math.max(measuredWidth + fontSize * 1.8, 80), 2200));
  const height = Math.ceil(fontSize * 2.25);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);

  const ctx = canvas.getContext("2d");
  ctx.scale(pixelRatio, pixelRatio);
  ctx.clearRect(0, 0, width, height);
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = pdfWatermarkForm.color || "#ff4f93";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);

  const pngBytes = dataUrlToUint8Array(canvas.toDataURL("image/png"));
  const image = await pdfDoc.embedPng(pngBytes);
  return { image, width, height, kind: "text" };
}

function drawWatermarkOnPage(page, watermark, PDFLib) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const opacity = clampNumber(pdfWatermarkForm.opacity, 5, 80, 18) / 100;
  const rotate = PDFLib.degrees(clampNumber(pdfWatermarkForm.rotation, -90, 90, -35));
  const maxWidthRatio = watermark.kind === "image"
    ? clampNumber(pdfWatermarkForm.imageScale, 6, 45, 18) / 100
    : 0.72;
  const scale = Math.min(1, pageWidth * maxWidthRatio / watermark.width);
  const width = watermark.width * scale;
  const height = watermark.height * scale;

  if (pdfWatermarkForm.mode === "center") {
    page.drawImage(watermark.image, {
      x: pageWidth / 2 - width / 2,
      y: pageHeight / 2 - height / 2,
      width,
      height,
      rotate,
      opacity
    });
    return;
  }

  const gapX = watermark.kind === "image" ? Math.max(width * 2.4, 220) : Math.max(width * 1.65, 180);
  const gapY = watermark.kind === "image" ? Math.max(height * 2.8, 180) : Math.max(height * 3.8, 150);
  for (let y = -pageHeight; y < pageHeight * 2; y += gapY) {
    for (let x = -pageWidth; x < pageWidth * 2; x += gapX) {
      page.drawImage(watermark.image, { x, y, width, height, rotate, opacity });
    }
  }
}
function clearPdfWatermark() {
  revokePdfWatermarkPreview();
  pdfWatermarkFileName.value = "";
  pdfWatermarkArrayBuffer.value = null;
  pdfWatermarkPageCount.value = 0;
  pdfWatermarkProcessing.value = false;
  pdfWatermarkProgress.value = 0;
  pdfWatermarkImageFileName.value = "";
  pdfWatermarkImageDataUrl.value = "";
  pdfWatermarkUpload.value?.clearFiles?.();
  pdfWatermarkImageUpload.value?.clearFiles?.();
}

function revokePdfWatermarkPreview() {
  if (pdfWatermarkPreviewUrl.value) {
    URL.revokeObjectURL(pdfWatermarkPreviewUrl.value);
  }
  pdfWatermarkPreviewUrl.value = "";
  pdfWatermarkPreviewBlob.value = null;
}

async function onImageWatermarkPick(file, fileList) {
  const files = fileList.map((item) => item.raw).filter((item) => item && imageExts.has(fileExt(item)));
  if (!files.length) {
    ElMessage.warning("请上传 jpg / png / webp 图片");
    return;
  }

  imageWatermarkFiles.value = files;
  resetImageWatermarkItems();
  await refreshImageWatermarkPreview();
}

function resetImageWatermarkItems() {
  revokeImageWatermarkItems();
  imageWatermarkItems.value = imageWatermarkFiles.value.map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    file,
    name: file.name,
    sourceUrl: URL.createObjectURL(file),
    watermarkedUrl: "",
    blob: null
  }));
}

async function refreshImageWatermarkPreview() {
  if (!imageWatermarkFiles.value.length || imageWatermarkProcessing.value) return;
  if (!imageWatermarkItems.value.length) resetImageWatermarkItems();

  imageWatermarkProcessing.value = true;
  imageWatermarkProgress.value = 8;
  try {
    for (let index = 0; index < imageWatermarkItems.value.length; index += 1) {
      const item = imageWatermarkItems.value[index];
      if (item.watermarkedUrl) URL.revokeObjectURL(item.watermarkedUrl);
      const blob = await createImageWatermarkBlob(item.file);
      item.blob = blob;
      item.watermarkedUrl = URL.createObjectURL(blob);
      imageWatermarkProgress.value = Math.round(((index + 1) / imageWatermarkItems.value.length) * 100);
      await nextFrame();
    }
    ElMessage.success("图片水印预览已生成");
  } catch (error) {
    ElMessage.warning(error.message || "图片水印生成失败");
  } finally {
    imageWatermarkProcessing.value = false;
  }
}

async function createImageWatermarkBlob(file) {
  const info = await loadImageInfo(await fileToDataUrl(file));
  const canvas = document.createElement("canvas");
  canvas.width = info.width;
  canvas.height = info.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(info.image, 0, 0, info.width, info.height);

  const text = (imageWatermarkForm.text || "").trim();
  if (text) drawImageTextWatermark(ctx, info.width, info.height, text);

  const ext = fileExt(file) === "jpg" ? "jpeg" : fileExt(file);
  const type = imageMime(ext);
  return await canvasToBlob(canvas, type, 0.92);
}

function drawImageTextWatermark(ctx, width, height, text) {
  const maxFontSize = Math.max(12, Math.min(width, height) * 0.07);
  let fontSize = Math.min(clampNumber(imageWatermarkForm.fontSize, 12, 80, 24), maxFontSize);
  const fontFamily = "\"Microsoft YaHei\", \"PingFang SC\", Arial, sans-serif";
  const maxTextWidth = imageWatermarkForm.position === "center" ? width * 0.62 : width * 0.38;
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  while (ctx.measureText(text).width > maxTextWidth && fontSize > 12) {
    fontSize -= 1;
    ctx.font = `700 ${fontSize}px ${fontFamily}`;
  }

  const metrics = ctx.measureText(text);
  const padding = Math.max(16, Math.min(width, height) * 0.035);
  const textHeight = fontSize * 1.2;
  const position = imageWatermarkPosition(width, height, metrics.width, textHeight, padding);

  ctx.save();
  ctx.globalAlpha = clampNumber(imageWatermarkForm.opacity, 8, 45, 18) / 100;
  ctx.textAlign = position.align;
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  if (imageWatermarkForm.shadow) {
    ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.42)";
    ctx.strokeText(text, position.x, position.y);
  }
  ctx.fillStyle = imageWatermarkForm.color || "#ffffff";
  ctx.fillText(text, position.x, position.y);
  ctx.restore();
}

function imageWatermarkPosition(width, height, textWidth, textHeight, padding) {
  if (imageWatermarkForm.position === "bottom-left") return { x: padding, y: height - padding - textHeight / 2, align: "left" };
  if (imageWatermarkForm.position === "top-right") return { x: width - padding, y: padding + textHeight / 2, align: "right" };
  if (imageWatermarkForm.position === "center") return { x: width / 2, y: height / 2, align: "center" };
  return { x: width - padding, y: height - padding - textHeight / 2, align: "right" };
}

async function downloadImageWatermarks() {
  if (!imageWatermarkItems.value.length) return ElMessage.warning("请先上传图片");
  if (imageWatermarkItems.value.some((item) => !item.blob)) await refreshImageWatermarkPreview();

  imageWatermarkItems.value.forEach((item) => {
    if (!item.blob) return;
    const ext = imageExtension(fileExt(item.file) === "jpg" ? "jpeg" : fileExt(item.file));
    saveBlob(item.blob, `${safeOutputFileName(fileBaseName(item.name))}_水印.${ext}`);
  });
  ElMessage.success("水印图片已开始下载");
}

function clearImageWatermark() {
  imageWatermarkFiles.value = [];
  revokeImageWatermarkItems();
  imageWatermarkProcessing.value = false;
  imageWatermarkProgress.value = 0;
}

function revokeImageWatermarkItems() {
  imageWatermarkItems.value.forEach((item) => {
    if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    if (item.watermarkedUrl) URL.revokeObjectURL(item.watermarkedUrl);
  });
  imageWatermarkItems.value = [];
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImageInfo(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({ image, width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL("image/png") });
    };
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = source;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片导出失败"));
    }, type, quality);
  });
}
function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function formatPercent(value) {
  return `${value}%`;
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function openHtmlEditorDialog() {
  dialogVisible.htmlEditor = true;
  updateHtmlPreview();
}

function scheduleHtmlPreview() {
  window.clearTimeout(htmlPreviewTimer);
  htmlPreviewTimer = window.setTimeout(() => updateHtmlPreview(), 500);
}

function updateHtmlPreview() {
  window.clearTimeout(htmlPreviewTimer);
  htmlPreviewSource.value = htmlEditorContent.value;
  htmlPreviewKey.value += 1;
}

function refreshHtmlPreview() {
  updateHtmlPreview();
  ElMessage.success("HTML 预览已刷新");
}

function clampHtmlZoom(value) {
  return Math.min(3, Math.max(0.1, Number(value.toFixed(2))));
}

function zoomInHtmlPreview() {
  htmlPreviewZoom.value = clampHtmlZoom(htmlPreviewZoom.value + 0.1);
}

function zoomOutHtmlPreview() {
  htmlPreviewZoom.value = clampHtmlZoom(htmlPreviewZoom.value - 0.1);
}

function resetHtmlPreviewZoom() {
  htmlPreviewZoom.value = 1;
}

async function fitHtmlPreviewToWindow() {
  await nextFrame();
  const container = htmlPreviewContainer.value;
  const frame = htmlPreviewFrame.value;
  if (!container) return;

  let contentWidth = 1080;
  let contentHeight = 800;
  try {
    const doc = frame?.contentDocument;
    const body = doc?.body;
    const root = doc?.documentElement;
    contentWidth = Math.max(body?.scrollWidth || 0, root?.scrollWidth || 0, contentWidth);
    contentHeight = Math.max(body?.scrollHeight || 0, root?.scrollHeight || 0, contentHeight);
  } catch {
    // Sandboxed previews may block measurement; the default page size still gives a useful fit.
  }

  const scaleX = (container.clientWidth - 20) / contentWidth;
  const scaleY = (container.clientHeight - 20) / contentHeight;
  htmlPreviewZoom.value = clampHtmlZoom(Math.min(scaleX, scaleY, 1));
}

function downloadHtmlFile() {
  if (!htmlEditorContent.value.trim()) {
    ElMessage.warning("请先输入 HTML 代码");
    return;
  }
  const fileName = `html-page-${Date.now()}.html`;
  saveBlob(new Blob([htmlEditorContent.value], { type: "text/html;charset=utf-8" }), fileName);
  ElMessage.success("HTML 文件已下载");
}

function clearHtmlEditor() {
  if (!window.confirm("确定要清空 HTML 编辑器内容吗？")) return;
  htmlEditorContent.value = "";
  updateHtmlPreview();
}

function loadHtmlExample() {
  htmlEditorContent.value = defaultHtmlContent;
  updateHtmlPreview();
  ElMessage.success("HTML 示例已载入");
}

function handleHtmlEditorKeydown(event) {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "s") {
    event.preventDefault();
    refreshHtmlPreview();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === "d") {
    event.preventDefault();
    downloadHtmlFile();
    return;
  }
  if (event.key !== "Tab") return;

  event.preventDefault();
  const textarea = event.target;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = htmlEditorContent.value;
  htmlEditorContent.value = `${value.slice(0, start)}  ${value.slice(end)}`;
  scheduleHtmlPreview();
  nextFrame().then(() => {
    textarea.selectionStart = start + 2;
    textarea.selectionEnd = start + 2;
  });
}

async function onMarkdownFileChange(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!["md", "markdown", "txt"].includes(fileExt(file))) {
    ElMessage.warning("请上传 md / markdown / txt 文件");
    return;
  }

  markdownContent.value = await file.text();
  markdownFileName.value = file.name;
  markdownViewMode.value = "split";
  ElMessage.success("Markdown 文件已导入");
}

function insertMarkdownSnippet(type) {
  const textarea = document.querySelector(".markdown-editor-dialog textarea");
  const value = markdownContent.value || "";
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const replacement = createMarkdownReplacement(type, selected);
  markdownContent.value = `${value.slice(0, start)}${replacement.text}${value.slice(end)}`;

  nextFrame().then(() => {
    const updatedTextarea = document.querySelector(".markdown-editor-dialog textarea");
    if (!updatedTextarea) return;
    updatedTextarea.focus();
    const cursorStart = start + (replacement.cursorStart ?? replacement.text.length);
    const cursorEnd = start + (replacement.cursorEnd ?? replacement.text.length);
    updatedTextarea.setSelectionRange(cursorStart, cursorEnd);
  });
}

function createMarkdownReplacement(type, selected) {
  const text = selected || "";
  const lineText = text || "内容";
  const map = {
    h1: () => ({ text: `# ${lineText}`, cursorStart: 2, cursorEnd: 2 + lineText.length }),
    h2: () => ({ text: `## ${lineText}`, cursorStart: 3, cursorEnd: 3 + lineText.length }),
    bold: () => ({ text: `**${text || "加粗文字"}**`, cursorStart: 2, cursorEnd: 2 + (text || "加粗文字").length }),
    italic: () => ({ text: `*${text || "斜体文字"}*`, cursorStart: 1, cursorEnd: 1 + (text || "斜体文字").length }),
    quote: () => ({ text: prefixMarkdownLines(lineText, "> ") }),
    list: () => ({ text: prefixMarkdownLines(lineText, "- ") }),
    code: () => ({ text: `\`\`\`js\n${text || "console.log(\"Hello Markdown\")"}\n\`\`\`` }),
    link: () => ({ text: `[${text || "链接文字"}](https://example.com)`, cursorStart: 1, cursorEnd: 1 + (text || "链接文字").length }),
    table: () => ({ text: `| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |` })
  };
  return (map[type] || map.bold)();
}

function prefixMarkdownLines(text, prefix) {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => `${prefix}${line || "内容"}`)
    .join("\n");
}

function loadMarkdownExample() {
  markdownFileName.value = "教辅图文范文.md";
  markdownContent.value = `# 三年级数学：两位数乘一位数

## 知识点

- 先把两位数拆成整十数和个位数
- 分别相乘后再相加
- 竖式计算时要注意进位

## 例题

**24 × 3 = ?**

1. 20 × 3 = 60
2. 4 × 3 = 12
3. 60 + 12 = 72

> 小技巧：先拆分，再合并，计算会更清楚。
`;
  markdownViewMode.value = "split";
}

function clearMarkdownEditor() {
  markdownContent.value = "";
  markdownFileName.value = "未命名文档.md";
}

function downloadMarkdown() {
  const fileName = safeOutputFileName(markdownFileName.value || "markdown.md");
  const normalizedName = /\.(md|markdown|txt)$/i.test(fileName) ? fileName : `${fileName}.md`;
  saveBlob(new Blob([markdownContent.value], { type: "text/markdown;charset=utf-8" }), normalizedName);
  ElMessage.success("Markdown 已下载");
}

function copyMarkdown() {
  copyTextToClipboard(markdownContent.value, "Markdown 已复制");
}

function copyMarkdownHtml() {
  copyTextToClipboard(markdownPreviewHtml.value, "HTML 已复制");
}

async function copyTextToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  ElMessage.success(successMessage);
}

function renderMarkdown(source) {
  const lines = String(source || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const html = [];
  const paragraph = [];
  let listType = "";
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderMarkdownInline(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  };
  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        html.push(`<pre><code class="language-${escapeAttribute(codeLanguage)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCodeBlock = false;
        codeLanguage = "";
        codeLines = [];
      } else {
        flushParagraph();
        closeList();
        inCodeBlock = true;
        codeLanguage = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      flushParagraph();
      closeList();
      const table = collectMarkdownTable(lines, index);
      html.push(renderMarkdownTable(table.rows));
      index = table.nextIndex - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderMarkdownInline(quote[1])}</blockquote>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextListType = ordered ? "ol" : "ul";
      if (listType && listType !== nextListType) closeList();
      if (!listType) {
        listType = nextListType;
        html.push(`<${listType}>`);
      }
      html.push(`<li>${renderMarkdownInline((ordered || unordered)[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  if (inCodeBlock) {
    html.push(`<pre><code class="language-${escapeAttribute(codeLanguage)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph();
  closeList();

  return html.join("\n") || `<p class="markdown-preview-empty">开始输入后，这里会显示预览。</p>`;
}

function renderMarkdownInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${safeMarkdownUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
}

function isMarkdownTableStart(lines, index) {
  return lines[index]?.includes("|") && isMarkdownTableDivider(lines[index + 1] || "");
}

function isMarkdownTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function collectMarkdownTable(lines, startIndex) {
  const rows = [splitMarkdownTableRow(lines[startIndex])];
  let index = startIndex + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(splitMarkdownTableRow(lines[index]));
    index += 1;
  }
  return { rows, nextIndex: index };
}

function splitMarkdownTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderMarkdownTable(rows) {
  if (!rows.length) return "";
  const [header, ...body] = rows;
  const headHtml = header.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join("");
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${renderMarkdownInline(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function safeMarkdownUrl(value) {
  const url = String(value || "").trim().replace(/&amp;/g, "&");
  if (/^(https?:|mailto:|#|\/)/i.test(url)) return escapeAttribute(url);
  return "#";
}

function clearOutputFolder() {
  outputDirectoryHandle.value = null;
  convertSettings.outputFolder = "";
}

async function pickOutputFolder() {
  if (!window.showDirectoryPicker) {
    outputDirectoryHandle.value = null;
    ElMessage.warning("当前浏览器不支持直接选择输出文件夹，请手动输入本机绝对路径");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    outputDirectoryHandle.value = handle;
    convertSettings.outputFolder = handle.name;
    addConvertLog("success", `已选择输出文件夹：${handle.name}`);
  } catch (error) {
    if (error?.name !== "AbortError") {
      ElMessage.warning("输出文件夹选择失败");
    }
  }
}

function createJob(file, type) {
  const job = {
    id: `${Date.now()}-${Math.random()}`,
    name: file?.name || "图片转PDF",
    type,
    status: "running",
    progress: 8,
    message: "等待处理",
    downloadUrl: "",
    pdfUrl: "",
    pptUrl: "",
    wordUrl: "",
    pages: []
  };
  convertJobs.value.push(job);
  return convertJobs.value[convertJobs.value.length - 1];
}

function updateJob(job, patch) {
  const index = convertJobs.value.findIndex((item) => item.id === job.id);
  const target = index >= 0 ? convertJobs.value[index] : job;
  Object.assign(target, patch);
  if (target !== job) Object.assign(job, patch);
  if (index >= 0) convertJobs.value = [...convertJobs.value];
}

function startJobProgress(job, message = "正在转换，页数较多时请耐心等待") {
  const timer = window.setInterval(() => {
    if (job.status !== "running") return;
    const current = Number(job.progress) || 0;
    const step = current < 55 ? 3 : current < 78 ? 2 : 1;
    updateJob(job, {
      progress: Math.min(92, current + step),
      message
    });
  }, 1200);
  return () => window.clearInterval(timer);
}

function addConvertLog(level, message) {
  const levelMap = {
    info: "信息",
    success: "完成",
    warn: "提醒",
    error: "错误"
  };
  convertLogs.value.unshift({
    id: `${Date.now()}-${Math.random()}`,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    level,
    levelText: levelMap[level] || "信息",
    message
  });
}

function requestOptions() {
  return {
    resolution: convertSettings.resolution,
    imageFormat: convertSettings.imageFormat,
    quality: convertSettings.quality,
    separateFolder: convertSettings.separateFolder,
    outputFolder: outputDirectoryHandle.value ? "" : convertSettings.outputFolder.trim()
  };
}

async function runFilesToImages(files, { label, jobType }) {
  if (!files.length) return ElMessage.warning(`请先选择${label}文件`);
  if (converting.value) return;

  converting.value = true;
  convertCanceled.value = false;
  convertResult.value = { pages: [], downloadUrl: "" };
  convertJobs.value = [];
  addConvertLog("info", `开始${label}转图片，共 ${files.length} 个文件`);

  for (const file of files) {
    if (convertCanceled.value) break;
    const job = createJob(file, jobType);
    activeAbortController.value = new AbortController();
    updateJob(job, { progress: 18, message: "正在上传并转换" });
    const stopJobProgress = startJobProgress(job);
    try {
      const res = await convertDocumentToImages(file, {
        ...requestOptions(),
        signal: activeAbortController.value.signal,
        timeout: 1800000,
        onUploadProgress: (event) => {
          if (!event.total) return;
          const uploadProgress = 18 + Math.round((event.loaded / event.total) * 17);
          updateJob(job, {
            progress: Math.max(job.progress, Math.min(35, uploadProgress)),
            message: "正在上传文件"
          });
        }
      });
      stopJobProgress();
      const pages = res.data.pages || [];
      convertResult.value = {
        pages,
        downloadUrl: res.data.downloadUrl || ""
      };
      updateJob(job, {
        status: "success",
        progress: 100,
        message: `已生成 ${pages.length} 张图片`,
        downloadUrl: res.data.downloadUrl || "",
        pages
      });
      addConvertLog("success", `${file.name} 已生成 ${pages.length} 张图片`);
      await saveDownloadToOutputFolder(res.data.downloadUrl, `${fileBaseName(file.name)}-图片.zip`);
    } catch (error) {
      stopJobProgress();
      const canceled = error.code === "ERR_CANCELED" || convertCanceled.value;
      updateJob(job, {
        status: canceled ? "warn" : "error",
        progress: canceled ? job.progress : 100,
        message: canceled ? "已取消" : (error.response?.data?.message || "转换失败")
      });
      addConvertLog(canceled ? "warn" : "error", `${file.name} ${canceled ? "已取消" : job.message}`);
      if (!canceled) ElMessage.warning(error.response?.data?.message || `${label}转图片失败`);
    }
  }

  activeAbortController.value = null;
  converting.value = false;
  if (convertCanceled.value) {
    addConvertLog("warn", "已取消剩余任务");
  } else {
    addConvertLog("success", `${label}转图片处理完成`);
  }
}

async function runDocumentToImages() {
  return runFilesToImages(documentFiles.value, { label: "文档", jobType: "document" });
}

async function runPresentationToImages() {
  return runFilesToImages(presentationFiles.value, { label: "PPT", jobType: "presentation" });
}

async function runImagesToPdf() {
  if (!imageFiles.value.length) return ElMessage.warning("请先选择图片文件");
  if (converting.value) return;

  converting.value = true;
  convertCanceled.value = false;
  convertJobs.value = [];
  const orderedImages = sortFilesByNaturalName(imageFiles.value);
  const job = createJob({ name: convertSettings.fileName || "图片合并.pdf" }, "pdf");
  activeAbortController.value = new AbortController();
  addConvertLog("info", `开始图片转 PDF，共 ${orderedImages.length} 张图片`);
  updateJob(job, { progress: 20, message: "正在合并图片" });
  try {
    const res = await convertImagesToPdf(orderedImages, {
      resolution: convertSettings.resolution,
      quality: convertSettings.quality,
      outputFolder: outputDirectoryHandle.value ? "" : convertSettings.outputFolder.trim(),
      fileName: convertSettings.fileName,
      signal: activeAbortController.value.signal
    });
    updateJob(job, {
      status: "success",
      progress: 100,
      message: `已合并 ${res.data.pageCount || orderedImages.length} 页`,
      downloadUrl: res.data.downloadUrl || "",
      pdfUrl: res.data.pdfUrl || ""
    });
    addConvertLog("success", `图片转 PDF 完成：${res.data.fileName || "images.pdf"}`);
    await saveDownloadToOutputFolder(res.data.downloadUrl, res.data.fileName || "images.pdf");
    ElMessage.success("图片转 PDF 完成");
  } catch (error) {
    const canceled = error.code === "ERR_CANCELED" || convertCanceled.value;
    updateJob(job, {
      status: canceled ? "warn" : "error",
      progress: canceled ? job.progress : 100,
      message: canceled ? "已取消" : (error.response?.data?.message || "图片转 PDF 失败")
    });
    addConvertLog(canceled ? "warn" : "error", canceled ? "图片转 PDF 已取消" : job.message);
    if (!canceled) ElMessage.warning(error.response?.data?.message || "图片转 PDF 失败");
  } finally {
    activeAbortController.value = null;
    converting.value = false;
  }
}

async function runImagesToPpt() {
  if (!imageFiles.value.length) return ElMessage.warning("请先选择图片文件");
  if (converting.value) return;

  converting.value = true;
  convertCanceled.value = false;
  convertJobs.value = [];
  const orderedImages = sortFilesByNaturalName(imageFiles.value);
  const job = createJob({ name: convertSettings.fileName || "图片合并.pptx" }, "ppt");
  activeAbortController.value = new AbortController();
  addConvertLog("info", `开始图片转 PPT，共 ${orderedImages.length} 张图片`);
  updateJob(job, { progress: 20, message: "正在生成幻灯片" });
  try {
    const res = await convertImagesToPpt(orderedImages, {
      outputFolder: outputDirectoryHandle.value ? "" : convertSettings.outputFolder.trim(),
      fileName: convertSettings.fileName,
      signal: activeAbortController.value.signal
    });
    updateJob(job, {
      status: "success",
      progress: 100,
      message: `已生成 ${res.data.slideCount || orderedImages.length} 页`,
      downloadUrl: res.data.downloadUrl || "",
      pptUrl: res.data.pptUrl || ""
    });
    addConvertLog("success", `图片转 PPT 完成：${res.data.fileName || "images.pptx"}`);
    await saveDownloadToOutputFolder(res.data.downloadUrl, res.data.fileName || "images.pptx");
    ElMessage.success("图片转 PPT 完成");
  } catch (error) {
    const canceled = error.code === "ERR_CANCELED" || convertCanceled.value;
    updateJob(job, {
      status: canceled ? "warn" : "error",
      progress: canceled ? job.progress : 100,
      message: canceled ? "已取消" : (error.response?.data?.message || "图片转 PPT 失败")
    });
    addConvertLog(canceled ? "warn" : "error", canceled ? "图片转 PPT 已取消" : job.message);
    if (!canceled) ElMessage.warning(error.response?.data?.message || "图片转 PPT 失败");
  } finally {
    activeAbortController.value = null;
    converting.value = false;
  }
}

async function runPdfToWord() {
  if (!pdfFiles.value.length) return ElMessage.warning("请先选择 PDF 文件");
  if (converting.value) return;

  converting.value = true;
  convertCanceled.value = false;
  convertJobs.value = [];
  addConvertLog("info", `开始 PDF 转 Word，共 ${pdfFiles.value.length} 个 PDF`);

  for (const file of pdfFiles.value) {
    if (convertCanceled.value) break;
    const job = createJob(file, "word");
    activeAbortController.value = new AbortController();
    updateJob(job, { progress: 18, message: "正在提取 PDF 文字" });
    const stopJobProgress = startJobProgress(job, "正在生成 Word 文档");
    try {
      const res = await convertPdfToWord(file, {
        outputFolder: outputDirectoryHandle.value ? "" : convertSettings.outputFolder.trim(),
        fileName: fileBaseName(file.name),
        signal: activeAbortController.value.signal
      });
      stopJobProgress();
      updateJob(job, {
        status: "success",
        progress: 100,
        message: "Word 文档已生成",
        downloadUrl: res.data.downloadUrl || "",
        wordUrl: res.data.wordUrl || ""
      });
      addConvertLog("success", `PDF 转 Word 完成：${res.data.fileName || `${fileBaseName(file.name)}.docx`}`);
      await saveDownloadToOutputFolder(res.data.downloadUrl, res.data.fileName || `${fileBaseName(file.name)}.docx`);
      ElMessage.success("PDF 转 Word 完成");
    } catch (error) {
      stopJobProgress();
      const canceled = error.code === "ERR_CANCELED" || convertCanceled.value;
      updateJob(job, {
        status: canceled ? "warn" : "error",
        progress: canceled ? job.progress : 100,
        message: canceled ? "已取消" : (error.response?.data?.message || "PDF 转 Word 失败")
      });
      addConvertLog(canceled ? "warn" : "error", canceled ? "PDF 转 Word 已取消" : job.message);
      if (!canceled) ElMessage.warning(error.response?.data?.message || "PDF 转 Word 失败");
    }
  }

  activeAbortController.value = null;
  converting.value = false;
  if (convertCanceled.value) addConvertLog("warn", "已取消剩余任务");
}

function cancelConversion() {
  convertCanceled.value = true;
  activeAbortController.value?.abort();
}

function saveConvertSettings() {
  persistLatestToolSettings();
  addConvertLog("success", "转换设置已保存");
  ElMessage.success("转换设置已保存");
}

function persistLatestToolSettings() {
  const savedConvertSettings = { ...convertSettings };
  if (outputDirectoryHandle.value) savedConvertSettings.outputFolder = "";
  localStorage.setItem(settingsKey, JSON.stringify(savedConvertSettings));
  localStorage.setItem(latestToolSettingsKey, JSON.stringify({
    convertSettings: savedConvertSettings,
    textReferenceForm: { ...textReferenceForm },
    pdfWatermarkForm: { ...pdfWatermarkForm },
    imageWatermarkForm: { ...imageWatermarkForm },
    pdfShuffleAddPageNumbers: pdfShuffleAddPageNumbers.value,
    markdownViewMode: markdownViewMode.value
  }));
}

function loadLatestToolSettings() {
  try {
    const latest = JSON.parse(localStorage.getItem(latestToolSettingsKey) || "{}");
    const saved = latest.convertSettings || JSON.parse(localStorage.getItem(settingsKey) || "{}");
    if (saved.pdfName && !saved.fileName) saved.fileName = saved.pdfName;
    if (saved.dpi && !saved.resolution) saved.resolution = dpiToResolution(saved.dpi);
    Object.assign(convertSettings, saved);
    Object.assign(textReferenceForm, latest.textReferenceForm || {});
    Object.assign(pdfWatermarkForm, latest.pdfWatermarkForm || {});
    Object.assign(imageWatermarkForm, latest.imageWatermarkForm || {});
    if (typeof latest.pdfShuffleAddPageNumbers === "boolean") pdfShuffleAddPageNumbers.value = latest.pdfShuffleAddPageNumbers;
    if (["edit", "preview", "split"].includes(latest.markdownViewMode)) markdownViewMode.value = latest.markdownViewMode;
  } catch {
    localStorage.removeItem(settingsKey);
    localStorage.removeItem(latestToolSettingsKey);
  }
}

function dpiToResolution(dpi) {
  const value = Number(dpi) || 180;
  if (value <= 120) return "1k";
  if (value >= 300) return "4k";
  return "2k";
}

function fileBaseName(fileName = "document") {
  return String(fileName).replace(/\.[^.]+$/, "") || "document";
}

function safeOutputFileName(fileName = "download") {
  return String(fileName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

async function saveDownloadToOutputFolder(url, fileName) {
  if (!outputDirectoryHandle.value || !url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const fileHandle = await outputDirectoryHandle.value.getFileHandle(safeOutputFileName(fileName), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    addConvertLog("success", `已保存到输出文件夹：${fileName}`);
  } catch (error) {
    addConvertLog("error", `保存到输出文件夹失败：${fileName}`);
    ElMessage.warning("结果已生成，但保存到输出文件夹失败，请手动下载");
  }
}

function downloadConverted(job) {
  const url = job?.downloadUrl || convertResult.value.downloadUrl;
  if (url) window.location.href = url;
}

function open(url) {
  if (url) window.open(url, "_blank");
}
</script>
