package com.service;

import com.entity.Document;
import java.util.List;

public interface DocumentService {
    Document save(Document doc);
    List<Document> getAll();
    List<Document> getByType(String type);
}