import apiClient from './axios.config.js';

export const wikiApi = {
  getSpaces: () => apiClient.get('/api/wiki/spaces'),
  getSpacePages: (spaceId) => apiClient.get(`/api/wiki/space/${spaceId}/pages`),
  getPage: (pageId) => apiClient.get(`/api/wiki/page/${pageId}`),
  searchPages: (query, spaceId) => apiClient.get('/api/wiki/search', { params: { q: query, space_id: spaceId } })
};

export default wikiApi;
