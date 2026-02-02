/**
 * TMDb 元数据服务
 * 用于自动匹配影片元数据（海报、简介、评分）
 */

class TmdbService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.themoviedb.org/3';
        this.imageBaseUrl = 'https://image.tmdb.org/t/p';
    }

    /**
     * 设置 API Key
     */
    setApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * 搜索电影
     * @param {string} query - 搜索关键词
     * @param {string} year - 年份（可选）
     * @param {string} language - 语言，默认中文
     */
    async searchMovie(query, year = null, language = 'zh-CN') {
        if (!this.apiKey) {
            console.warn('[TMDb] API key not configured');
            return [];
        }

        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                query,
                language,
                include_adult: 'false'
            });
            if (year) {
                params.set('year', year);
            }

            const response = await fetch(`${this.baseUrl}/search/movie?${params}`);
            const result = await response.json();

            return (result.results || []).map(item => this.normalizeMovie(item));
        } catch (error) {
            console.error('[TMDb] Search movie failed:', error);
            return [];
        }
    }

    /**
     * 搜索电视剧
     * @param {string} query - 搜索关键词
     * @param {string} year - 年份（可选）
     * @param {string} language - 语言，默认中文
     */
    async searchTV(query, year = null, language = 'zh-CN') {
        if (!this.apiKey) {
            return [];
        }

        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                query,
                language
            });
            if (year) {
                params.set('first_air_date_year', year);
            }

            const response = await fetch(`${this.baseUrl}/search/tv?${params}`);
            const result = await response.json();

            return (result.results || []).map(item => this.normalizeTV(item));
        } catch (error) {
            console.error('[TMDb] Search TV failed:', error);
            return [];
        }
    }

    /**
     * 多类型搜索（电影+电视剧）
     */
    async searchMulti(query, year = null, language = 'zh-CN') {
        if (!this.apiKey) {
            return [];
        }

        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                query,
                language,
                include_adult: 'false'
            });

            const response = await fetch(`${this.baseUrl}/search/multi?${params}`);
            const result = await response.json();

            return (result.results || [])
                .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
                .map(item => {
                    if (item.media_type === 'movie') {
                        return { ...this.normalizeMovie(item), media_type: 'movie' };
                    } else {
                        return { ...this.normalizeTV(item), media_type: 'tv' };
                    }
                });
        } catch (error) {
            console.error('[TMDb] Search multi failed:', error);
            return [];
        }
    }

    /**
     * 获取电影详情
     */
    async getMovieDetail(id, language = 'zh-CN') {
        if (!this.apiKey) return null;

        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                language,
                append_to_response: 'credits,videos,images'
            });

            const response = await fetch(`${this.baseUrl}/movie/${id}?${params}`);
            const result = await response.json();

            return this.normalizeMovieDetail(result);
        } catch (error) {
            console.error('[TMDb] Get movie detail failed:', error);
            return null;
        }
    }

    /**
     * 获取电视剧详情
     */
    async getTVDetail(id, language = 'zh-CN') {
        if (!this.apiKey) return null;

        try {
            const params = new URLSearchParams({
                api_key: this.apiKey,
                language,
                append_to_response: 'credits,videos,images'
            });

            const response = await fetch(`${this.baseUrl}/tv/${id}?${params}`);
            const result = await response.json();

            return this.normalizeTVDetail(result);
        } catch (error) {
            console.error('[TMDb] Get TV detail failed:', error);
            return null;
        }
    }

    /**
     * 获取海报列表
     */
    async getPosters(tmdbId, mediaType = 'movie') {
        if (!this.apiKey) return [];

        try {
            const path = mediaType === 'movie' ? 'movie' : 'tv';
            const response = await fetch(`${this.baseUrl}/${path}/${tmdbId}/images?api_key=${this.apiKey}`);
            const result = await response.json();

            if (!result.posters) return [];

            return result.posters.map(p => ({
                path: p.file_path,
                preview: `${this.imageBaseUrl}/w185${p.file_path}`,
                full: `${this.imageBaseUrl}/w500${p.file_path}`,
                width: p.width,
                height: p.height,
                vote_average: p.vote_average
            })).sort((a, b) => b.vote_average - a.vote_average);
        } catch (error) {
            console.error('[TMDb] Get posters failed:', error);
            return [];
        }
    }

    /**
     * 智能匹配 - 根据标题和年份自动匹配最佳结果
     */
    async match(title, year = null, type = 'auto') {
        // 清理标题
        const cleanTitle = title
            .replace(/第.+季/g, '')
            .replace(/season\s*\d+/gi, '')
            .replace(/S\d+/gi, '')
            .replace(/[（(].*[)）]/g, '')
            .trim();

        let results = [];

        if (type === 'movie') {
            results = await this.searchMovie(cleanTitle, year);
        } else if (type === 'tv') {
            results = await this.searchTV(cleanTitle, year);
        } else {
            results = await this.searchMulti(cleanTitle, year);
        }

        if (results.length === 0) {
            return null;
        }

        // 如果有年份，优先匹配年份相同的
        if (year) {
            const exactMatch = results.find(r => r.year === year);
            if (exactMatch) return exactMatch;
        }

        // 返回第一个结果
        return results[0];
    }

    /**
     * 标准化电影数据
     */
    normalizeMovie(item) {
        return {
            tmdb_id: item.id,
            title: item.title,
            original_title: item.original_title,
            overview: item.overview,
            poster: item.poster_path ? `${this.imageBaseUrl}/w500${item.poster_path}` : null,
            backdrop: item.backdrop_path ? `${this.imageBaseUrl}/original${item.backdrop_path}` : null,
            year: item.release_date ? item.release_date.substring(0, 4) : null,
            release_date: item.release_date,
            vote_average: item.vote_average,
            vote_count: item.vote_count,
            popularity: item.popularity
        };
    }

    /**
     * 标准化电视剧数据
     */
    normalizeTV(item) {
        return {
            tmdb_id: item.id,
            title: item.name,
            original_title: item.original_name,
            overview: item.overview,
            poster: item.poster_path ? `${this.imageBaseUrl}/w500${item.poster_path}` : null,
            backdrop: item.backdrop_path ? `${this.imageBaseUrl}/original${item.backdrop_path}` : null,
            year: item.first_air_date ? item.first_air_date.substring(0, 4) : null,
            first_air_date: item.first_air_date,
            vote_average: item.vote_average,
            vote_count: item.vote_count,
            popularity: item.popularity
        };
    }

    /**
     * 标准化电影详情
     */
    normalizeMovieDetail(item) {
        const base = this.normalizeMovie(item);
        return {
            ...base,
            runtime: item.runtime,
            genres: (item.genres || []).map(g => g.name),
            production_countries: (item.production_countries || []).map(c => c.name),
            cast: (item.credits?.cast || []).slice(0, 10).map(c => ({
                name: c.name,
                character: c.character,
                profile: c.profile_path ? `${this.imageBaseUrl}/w185${c.profile_path}` : null
            })),
            director: item.credits?.crew?.find(c => c.job === 'Director')?.name
        };
    }

    /**
     * 标准化电视剧详情
     */
    normalizeTVDetail(item) {
        const base = this.normalizeTV(item);
        return {
            ...base,
            number_of_seasons: item.number_of_seasons,
            number_of_episodes: item.number_of_episodes,
            episode_run_time: item.episode_run_time?.[0],
            genres: (item.genres || []).map(g => g.name),
            origin_country: item.origin_country,
            cast: (item.credits?.cast || []).slice(0, 10).map(c => ({
                name: c.name,
                character: c.character,
                profile: c.profile_path ? `${this.imageBaseUrl}/w185${c.profile_path}` : null
            })),
            created_by: (item.created_by || []).map(c => c.name)
        };
    }

    /**
     * 获取图片 URL
     */
    getImageUrl(path, size = 'w500') {
        if (!path) return null;
        return `${this.imageBaseUrl}/${size}${path}`;
    }
}

module.exports = { TmdbService };
