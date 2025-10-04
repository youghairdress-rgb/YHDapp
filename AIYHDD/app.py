# -*- coding: utf-8 -*-

import os
import uuid
import traceback
import json
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# AI・画像処理ライブラリ
import cv2
import numpy as np
import mediapipe as mp
from PIL import Image, ImageDraw, ImageFont

# Vertex AI SDK for Pythonをインポート
import vertexai
from vertexai.generative_models import GenerativeModel

# =================================================================
# ★★★ アプリケーション設定 ★★★
# =================================================================
# Google CloudプロジェクトIDとリージョンを設定
PROJECT_ID = "yhd-ai"
LOCATION = "asia-northeast1" # 東京リージョン

# Vertex AIを初期化
try:
    vertexai.init(project=PROJECT_ID, location=LOCATION)
except Exception as e:
    print(f"Vertex AIの初期化に失敗: {e}")

# =================================================================
# アプリケーションの初期化
# =================================================================
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["https://yhd-ai.web.app", "https://liff.line.me"]}})
mp_face_mesh = mp.solutions.face_mesh
mp_pose = mp.solutions.pose
TEMP_DIR = "temp"
if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)

# =================================================================
# AI診断のメイン関数 (変更なし)
# =================================================================
def analyze_face_and_skeleton(image, image_rgb, image_height, image_width):
    # (この関数の中身は変更ありません)
    analysis_data = { "face_shape": "判定不能", "shoulder_line": "判定不能", "face_landmarks": None }
    with mp_face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5) as face_mesh:
        results = face_mesh.process(image_rgb)
        if results.multi_face_landmarks:
            analysis_data["face_landmarks"] = results.multi_face_landmarks[0]
            p_forehead, p_chin = analysis_data["face_landmarks"].landmark[10], analysis_data["face_landmarks"].landmark[152]
            p_left_cheek, p_right_cheek = analysis_data["face_landmarks"].landmark[234], analysis_data["face_landmarks"].landmark[454]
            face_width = (p_right_cheek.x - p_left_cheek.x) * image_width
            face_height = (p_chin.y - p_forehead.y) * image_height
            if face_width > 0 and face_height > 0:
                ratio = face_height / face_width
                analysis_data["face_shape"] = "面長" if ratio > 1.5 else "丸顔" if ratio < 1.35 else "卵型"
    with mp_pose.Pose(static_image_mode=True, min_detection_confidence=0.5) as pose:
        results = pose.process(image_rgb)
        if results.pose_landmarks:
            landmarks = results.pose_landmarks.landmark
            left_shoulder, right_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER], landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
            if left_shoulder.visibility > 0.5 and right_shoulder.visibility > 0.5:
                y_diff = abs(left_shoulder.y - right_shoulder.y)
                analysis_data["shoulder_line"] = "なで肩" if y_diff >= 0.03 else "ストレート"
    return analysis_data

def analyze_personal_color(image, face_landmarks, image_height, image_width):
    # (この関数の中身は変更ありません)
    if not face_landmarks: return {"base_color": "判定不能", "season": "判定不能"}
    cheek_l_indices, forehead_indices = [230, 240, 250], [104, 69, 108]
    def get_avg_hsv(indices):
        points = np.array([(int(face_landmarks.landmark[i].x * image_width), int(face_landmarks.landmark[i].y * image_height)) for i in indices])
        mask = np.zeros((image_height, image_width), dtype=np.uint8)
        cv2.fillPoly(mask, [points], 255)
        mean_bgr = cv2.mean(image, mask=mask)
        mean_rgb = np.uint8([[list(mean_bgr[:3])[::-1]]])
        return cv2.cvtColor(mean_rgb, cv2.COLOR_RGB2HSV)[0][0]
    hsv_cheek, hsv_forehead = get_avg_hsv(cheek_l_indices), get_avg_hsv(forehead_indices)
    avg_hue = (hsv_cheek[0] + hsv_forehead[0]) / 2
    base_color = "イエローベース" if (avg_hue < 20 or avg_hue > 160) else "ブルーベース"
    season = "春" if base_color == "イエローベース" else "夏"
    return {"base_color": base_color, "season": season}

# =================================================================
# ★★★ Gemini API呼び出し関数 (Vertex AI SDKに変更) ★★★
# =================================================================
def get_ai_proposal(analysis_result):
    try:
        # モデルを明示的に指定
        model = GenerativeModel("gemini-1.5-flash-001")
        
        prompt = f"""
        あなたはプロのトップヘアスタイリストAIです。以下の顧客の診断結果を分析し、最高のヘアスタイル提案を行ってください。

        # 顧客の診断結果
        - 顔の形: {analysis_result.get("face_shape", "不明")}
        - 肌のベースカラー: {analysis_result.get("base_color", "不明")}
        - 肩のライン: {analysis_result.get("shoulder_line", "不明")}

        # 出力フォーマット (JSON形式で、以下のキーを必ず含めてください)
        {{
          "summary": "（診断結果を基にした総合的なスタイリングコメントを100文字程度で生成）",
          "hairstyleProposals": [
            {{"name": "（具体的なヘアスタイル名1）", "description": "（そのスタイルの簡単な説明）"}},
            {{"name": "（具体的なヘアスタイル名2）", "description": "（そのスタイルの簡単な説明）"}}
          ]
        }}
        """
        response = model.generate_content(prompt)
        
        # レスポンスからJSONを抽出
        json_text = response.text.strip().lstrip('```json').rstrip('```')
        json_response = json.loads(json_text)
        return json_response
    except Exception as e:
        print(f"Vertex AI (Gemini) API呼び出し中にエラー: {e}")
        # フロントエンドに返すためのエラー情報を作成
        return {"error": f"AI提案の生成中にエラーが発生しました。詳細: {e}"}

# =================================================================
# APIエンドポイント (変更なし)
# =================================================================
@app.route("/api/diagnose", methods=['POST'])
def diagnose():
    if 'front_photo' not in request.files: return jsonify({"error": "必須ファイルが見つかりません。"}), 400
    front_photo = request.files['front_photo']
    filename = str(uuid.uuid4()) + os.path.splitext(front_photo.filename)[1]
    image_path = os.path.join(TEMP_DIR, filename)
    try:
        front_photo.save(image_path)
        image = cv2.imread(image_path)
        if image is None: return jsonify({"error": "画像の読み込みに失敗。"}), 500
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        h, w, _ = image.shape
        
        analysis_result = analyze_face_and_skeleton(image, image_rgb, h, w)
        personal_color_result = analyze_personal_color(image, analysis_result["face_landmarks"], h, w)
        analysis_result.update(personal_color_result)
        
        del analysis_result["face_landmarks"] # 不要な情報は削除
        
        ai_proposals = get_ai_proposal(analysis_result)
        if "error" in ai_proposals: return jsonify(ai_proposals), 500
            
        final_analysis = {
            "face_shape": analysis_result.get("face_shape"),
            "season": f'{analysis_result.get("season")} ({analysis_result.get("base_color")})',
            "shoulder_line": analysis_result.get("shoulder_line")
        }

        response_data = {"analysisResult": final_analysis, "aiProposals": ai_proposals}
        return jsonify(response_data)
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": f"サーバー内部エラー: {e}"}), 500
    finally:
        if os.path.exists(image_path): os.remove(image_path)

@app.route("/api/generate_style", methods=['POST'])
def generate_style():
    if 'front_photo' not in request.files or 'prompt' not in request.form:
        return jsonify({"error": "必須データが不足。"}), 400
    dummy_image_path = 'dummy_generated_image.png'
    try:
        img = Image.new('RGB', (600, 400), color=(230, 240, 255))
        d = ImageDraw.Draw(img)
        font = ImageFont.load_default()
        d.text((10, 10), f"AI生成画像 (仮)\nプロンプト: {request.form['prompt']}", fill=(0, 0, 0), font=font)
        img.save(dummy_image_path)
        return send_file(dummy_image_path, mimetype='image/png')
    except Exception as e:
        return jsonify({"error": f"ダミー画像の生成に失敗: {e}"}), 500
    finally:
        if os.path.exists(dummy_image_path): os.remove(dummy_image_path)

@app.route("/")
def index():
    return "AI Top Stylist Backend is running!"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=True)

